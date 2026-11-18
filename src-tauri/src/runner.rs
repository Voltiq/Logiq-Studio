//! Finding a JDK and Node.js, compiling Java with `javac`, and running
//! programs with their output streamed to the page as it is written and
//! keyboard input passed to them while they run.

use serde::Serialize;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Programs run without a console window of their own; their output goes to the panel.
pub(crate) fn no_window(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000);
    cmd
}

fn exe(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

// ----- Finding tools ---------------------------------------------------------

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Jdk {
    pub(crate) home: String,
    version: String,
    major: u32,
    vendor: String,
}

/// Reads `release` in a JDK folder; a JRE (no javac) is not a JDK.
fn jdk_at(home: &Path) -> Option<Jdk> {
    if !home.join("bin").join(exe("javac")).is_file() {
        return None;
    }
    let release = std::fs::read_to_string(home.join("release")).unwrap_or_default();
    let field = |key: &str| {
        release
            .lines()
            .find_map(|l| l.strip_prefix(&format!("{key}=")))
            .map(|v| v.trim().trim_matches('"').to_string())
    };
    let version = field("JAVA_VERSION").unwrap_or_else(|| "?".into());
    let major = parse_major(&version);
    let vendor = field("IMPLEMENTOR").unwrap_or_default();
    Some(Jdk { home: home.to_string_lossy().to_string(), version, major, vendor })
}

/// "1.8.0_392" is Java 8; "21.0.2" is 21; "27" is 27.
pub fn parse_major(version: &str) -> u32 {
    let mut parts = version.split(|c: char| !c.is_ascii_digit()).filter(|p| !p.is_empty());
    match parts.next().and_then(|p| p.parse().ok()) {
        Some(1) => parts.next().and_then(|p| p.parse().ok()).unwrap_or(1),
        Some(n) => n,
        None => 0,
    }
}

fn path_dirs() -> Vec<PathBuf> {
    std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default()
}

#[tauri::command]
pub fn detect_jdks() -> Vec<Jdk> {
    let mut homes: Vec<PathBuf> = Vec::new();
    if let Some(h) = std::env::var_os("JAVA_HOME") {
        homes.push(PathBuf::from(h));
    }
    for dir in path_dirs() {
        if dir.join(exe("javac")).is_file() {
            // The Oracle installer puts javac.exe links into a "javapath" folder.
            let real = std::fs::canonicalize(dir.join(exe("javac"))).unwrap_or(dir.join(exe("javac")));
            if let Some(home) = real.parent().and_then(|b| b.parent()) {
                homes.push(home.to_path_buf());
            }
        }
    }
    let mut roots: Vec<PathBuf> = Vec::new();
    for var in ["ProgramFiles", "ProgramW6432", "ProgramFiles(x86)"] {
        if let Some(pf) = std::env::var_os(var) {
            let pf = PathBuf::from(pf);
            for vendor in ["Java", "Eclipse Adoptium", "Eclipse Foundation", "Microsoft", "Zulu", "Amazon Corretto", "BellSoft", "Semeru", "OpenJDK"] {
                roots.push(pf.join(vendor));
            }
        }
    }
    if let Some(home) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) {
        roots.push(PathBuf::from(home).join(".jdks"));
    }
    roots.push(PathBuf::from("/usr/lib/jvm"));
    roots.push(PathBuf::from("/Library/Java/JavaVirtualMachines"));
    for root in roots {
        if let Ok(rd) = std::fs::read_dir(&root) {
            for e in rd.flatten() {
                let p = e.path();
                homes.push(p.clone());
                homes.push(p.join("Contents").join("Home"));
            }
        }
    }
    let mut seen = std::collections::HashSet::new();
    let mut jdks: Vec<Jdk> = homes
        .into_iter()
        .filter_map(|h| {
            let key = std::fs::canonicalize(&h).unwrap_or(h.clone()).to_string_lossy().to_lowercase();
            if !seen.insert(key) {
                return None;
            }
            jdk_at(&h)
        })
        .collect();
    jdks.sort_by(|a, b| b.major.cmp(&a.major));
    jdks
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeInfo {
    path: String,
    version: String,
}

#[tauri::command]
pub async fn detect_node() -> Option<NodeInfo> {
    tauri::async_runtime::spawn_blocking(|| {
        let path = path_dirs().into_iter().map(|d| d.join(exe("node"))).find(|p| p.is_file())?;
        let out = no_window(Command::new(&path).arg("--version")).output().ok()?;
        Some(NodeInfo {
            path: path.to_string_lossy().to_string(),
            version: String::from_utf8_lossy(&out.stdout).trim().to_string(),
        })
    })
    .await
    .ok()
    .flatten()
}

pub(crate) fn java_bin(jdk_home: &Option<String>, tool: &str) -> PathBuf {
    match jdk_home {
        Some(h) if !h.is_empty() => Path::new(h).join("bin").join(exe(tool)),
        _ => detect_jdks()
            .first()
            .map(|j| Path::new(&j.home).join("bin").join(exe(tool)))
            .unwrap_or_else(|| PathBuf::from(exe(tool))),
    }
}

/// JavaFX (OpenJFX) in the project: its jars in `lib/javafx`, apart from `lib/*.jar` on the class path.
pub(crate) fn javafx_dir(root: &Path) -> Option<PathBuf> {
    let dir = root.join("lib").join("javafx");
    let has = std::fs::read_dir(&dir).ok()?.filter_map(|e| e.ok()).any(|e| e.path().extension().map(|x| x.eq_ignore_ascii_case("jar")).unwrap_or(false));
    has.then_some(dir)
}

/// What `java`, `javac` and `jshell` need for a project with JavaFX: its jars on the module path, with the
/// modules the designer's windows use. Nothing for other projects.
pub(crate) fn javafx_args(root: &Path) -> Vec<String> {
    match javafx_dir(root) {
        Some(dir) => vec!["--module-path".into(), dir.to_string_lossy().to_string(), "--add-modules".into(), "javafx.controls,javafx.fxml".into()],
        None => Vec::new(),
    }
}

/// For running: the module path, and what keeps newer JDKs from warning about JavaFX 21's native code
/// (`--enable-native-access`, and from Java 23 on `--sun-misc-unsafe-memory-access`, which older ones refuse).
pub(crate) fn javafx_run_args(root: &Path, jdk_home: &Option<String>) -> Vec<String> {
    let mut args = javafx_args(root);
    if args.is_empty() {
        return args;
    }
    args.push("--enable-native-access=javafx.graphics".into());
    if jdk_major(jdk_home) >= 23 {
        args.push("--sun-misc-unsafe-memory-access=allow".into());
    }
    args
}

/// The chosen JDK's version (the newest found when none is chosen); 0 when unknown.
fn jdk_major(jdk_home: &Option<String>) -> u32 {
    let jdk = match jdk_home {
        Some(h) => jdk_at(Path::new(h)),
        None => detect_jdks().into_iter().next(),
    };
    jdk.map(|j| parse_major(&j.version)).unwrap_or(0)
}

/// The same as one string of JVM options (the debugger's launch), the path quoted.
pub(crate) fn javafx_options(root: &Path, jdk_home: &Option<String>) -> String {
    javafx_run_args(root, jdk_home)
        .iter()
        .map(|a| if a.contains(' ') { format!("\"{a}\"") } else { a.clone() })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Files a program loads with `getResource` (FXML, style sheets, images…), copied from beside the sources into
/// `out`, where the classes are: into the folder of the package of a source file beside them, else at the same
/// place relative to `src` (or the project).
fn copy_resources(root: &Path, out: &Path) -> usize {
    const KINDS: [&str; 11] = ["fxml", "css", "png", "jpg", "jpeg", "gif", "bmp", "svg", "wav", "mp3", "properties"];
    let mut copied = 0;
    let mut package_of: std::collections::HashMap<PathBuf, Option<String>> = std::collections::HashMap::new();
    let src = root.join("src");
    crate::fs::walk(root, 20_000, &mut |p| {
        let Some(ext) = p.extension().map(|e| e.to_string_lossy().to_ascii_lowercase()) else { return };
        if !KINDS.contains(&ext.as_str()) || p.starts_with(out) || p.starts_with(root.join("lib")) {
            return;
        }
        let Some(dir) = p.parent() else { return };
        let pkg = package_of
            .entry(dir.to_path_buf())
            .or_insert_with(|| {
                let java = std::fs::read_dir(dir).ok()?.filter_map(|e| e.ok()).map(|e| e.path()).find(|f| f.extension().map(|e| e.eq_ignore_ascii_case("java")).unwrap_or(false))?;
                let text = std::fs::read_to_string(java).ok()?;
                Some(text.lines().find_map(|l| l.trim().strip_prefix("package ").map(|r| r.trim_end_matches(';').trim().to_string())).unwrap_or_default())
            })
            .clone();
        let target_dir = match pkg {
            Some(pkg) => out.join(pkg.replace('.', "/")),
            None => {
                let base = if dir.starts_with(&src) { &src } else { root };
                out.join(dir.strip_prefix(base).unwrap_or(Path::new("")))
            }
        };
        let target = target_dir.join(p.file_name().unwrap_or_default());
        let fresh = std::fs::metadata(&target).and_then(|t| Ok(t.modified()? >= std::fs::metadata(p)?.modified()?)).unwrap_or(false);
        if !fresh && std::fs::create_dir_all(&target_dir).is_ok() && std::fs::copy(p, &target).is_ok() {
            copied += 1;
        }
    });
    copied
}

/// The folder itself plus every jar in its `lib` folder.
pub(crate) fn class_path(root: &Path, out: &Path) -> String {
    let sep = if cfg!(windows) { ";" } else { ":" };
    // A Maven or Gradle project: the class path of its last build.
    let mut parts = match crate::build::saved_class_path(root) {
        Some(cp) => vec![cp],
        None => vec![out.to_string_lossy().to_string()],
    };
    if root.join("lib").is_dir() {
        parts.push(root.join("lib").join("*").to_string_lossy().to_string());
    }
    parts.join(sep)
}

// ----- Compiling ---------------------------------------------------------------

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    path: String,
    line: u32,
    /// 1-based, from javac's caret line; 0 when unknown.
    column: u32,
    severity: String,
    message: String,
}

impl Diagnostic {
    pub(crate) fn new(path: String, line: u32, column: u32, severity: &str, message: &str) -> Self {
        Diagnostic { path, line, column, severity: severity.into(), message: message.into() }
    }

    pub(crate) fn add_detail(&mut self, detail: &str) {
        self.message.push('\n');
        self.message.push_str(detail);
    }

    pub(crate) fn key(&self) -> String {
        // The first line only: the same problem can come with more or fewer details.
        format!("{}:{}:{}:{}", self.path, self.line, self.column, self.message.lines().next().unwrap_or(""))
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompileResult {
    pub(crate) ok: bool,
    diagnostics: Vec<Diagnostic>,
    pub(crate) output: String,
    files: usize,
    duration_ms: u64,
}

impl CompileResult {
    pub(crate) fn new(ok: bool, diagnostics: Vec<Diagnostic>, output: String, files: usize, duration_ms: u64) -> Self {
        CompileResult { ok, diagnostics, output, files, duration_ms }
    }
}

/// Reads javac's report: `File.java:12: error: message`, the source line, a
/// caret under the column, then indented detail lines (symbol, location).
pub fn parse_javac(output: &str) -> Vec<Diagnostic> {
    let header = regex::Regex::new(r"^(.+?\.java):(\d+): (error|warning|Fehler|Warnung): (.*)$").unwrap();
    let mut out: Vec<Diagnostic> = Vec::new();
    let lines: Vec<&str> = output.lines().collect();
    let mut i = 0;
    while i < lines.len() {
        let Some(c) = header.captures(lines[i]) else {
            i += 1;
            continue;
        };
        let severity = match &c[3] {
            "error" | "Fehler" => "error",
            _ => "warning",
        };
        let mut d = Diagnostic {
            path: c[1].to_string(),
            line: c[2].parse().unwrap_or(1),
            column: 0,
            severity: severity.into(),
            message: c[4].trim().to_string(),
        };
        i += 1;
        // Source line and caret.
        if i + 1 < lines.len() && lines[i + 1].trim() == "^" {
            d.column = lines[i + 1].find('^').map(|p| p as u32 + 1).unwrap_or(0);
            i += 2;
        }
        // Details such as "  symbol:   variable x" belong to the message.
        while i < lines.len() && lines[i].starts_with("  ") && !header.is_match(lines[i]) {
            let detail = lines[i].trim();
            if !detail.is_empty() {
                d.message.push('\n');
                d.message.push_str(detail);
            }
            i += 1;
        }
        out.push(d);
    }
    out
}

fn java_sources(root: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    crate::fs::walk(root, 20_000, &mut |p| {
        if p.extension().map(|e| e.eq_ignore_ascii_case("java")).unwrap_or(false) {
            files.push(p.to_path_buf());
        }
    });
    files
}

fn clear_classes(dir: &Path) {
    if let Ok(rd) = std::fs::read_dir(dir) {
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() {
                clear_classes(&p);
                let _ = std::fs::remove_dir(&p);
            } else if p.extension().map(|e| e == "class").unwrap_or(false) {
                let _ = std::fs::remove_file(&p);
            }
        }
    }
}

/// Compiles every .java file in the folder into `<root>/out`.
#[tauri::command]
pub async fn java_compile(root: String, jdk_home: Option<String>) -> Result<CompileResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let started = Instant::now();
        let root = PathBuf::from(&root);
        if crate::build::tool_of(&root).is_some() {
            return crate::build::compile(&root, &jdk_home);
        }
        let out_dir = root.join("out");
        let files = java_sources(&root);
        if files.is_empty() {
            return Err("There are no .java files in this folder.".to_string());
        }
        clear_classes(&out_dir);
        std::fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;
        // An argument file keeps long projects under the command line limit.
        let argfile = std::env::temp_dir().join(format!("logiq-javac-{}.txt", std::process::id()));
        let list: String = files
            .iter()
            .map(|f| format!("\"{}\"\n", f.to_string_lossy().replace('\\', "/")))
            .collect();
        std::fs::write(&argfile, list).map_err(|e| e.to_string())?;
        let javac = java_bin(&jdk_home, "javac");
        let output = no_window(
            Command::new(&javac)
                .current_dir(&root)
                .args(["-J-Duser.language=en", "-J-Dstdout.encoding=UTF-8", "-J-Dstderr.encoding=UTF-8"])
                .args(["-encoding", "UTF-8", "-g", "-Xlint:unchecked,deprecation", "-Xmaxerrs", "500"])
                .arg("-d")
                .arg(&out_dir)
                .arg("-cp")
                .arg(class_path(&root, &out_dir))
                .args(javafx_args(&root))
                .arg(format!("@{}", argfile.to_string_lossy())),
        )
        .output()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "No JDK was found. Install a JDK (for example from adoptium.net) or choose one in Settings.".to_string()
            } else {
                e.to_string()
            }
        })?;
        let _ = std::fs::remove_file(&argfile);
        copy_resources(&root, &out_dir);
        let text = format!(
            "{}{}",
            crate::fs::decode(&output.stdout),
            crate::fs::decode(&output.stderr)
        )
        .replace("\r\n", "\n");
        Ok(CompileResult {
            ok: output.status.success(),
            diagnostics: parse_javac(&text),
            output: text,
            files: files.len(),
            duration_ms: started.elapsed().as_millis() as u64,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The text of a file open in an editor, which may differ from the file on disk.
#[derive(serde::Deserialize)]
pub struct Buffer {
    path: String,
    text: String,
}

/// One check at a time; a second waits for the first.
static CHECKING: Mutex<()> = Mutex::new(());
static CHECKS: AtomicU32 = AtomicU32::new(0);

fn path_key(p: &str) -> String {
    p.replace('\\', "/").to_lowercase()
}

/// Checks the Java code of a plain folder (not Maven or Gradle) as it is in the editors: every .java file is
/// compiled, open files with their unsaved text, into a temporary folder that is removed afterwards; `out` is
/// left alone. Returns the problems, or None when the folder isn't checked this way.
#[tauri::command]
pub async fn java_check(root: String, jdk_home: Option<String>, buffers: Vec<Buffer>) -> Result<Option<Vec<Diagnostic>>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = PathBuf::from(&root);
        if crate::build::tool_of(&root).is_some() {
            return Ok(None);
        }
        let files = java_sources(&root);
        if files.is_empty() {
            return Ok(Some(Vec::new()));
        }
        let _one = CHECKING.lock().unwrap_or_else(|e| e.into_inner());
        let n = CHECKS.fetch_add(1, Ordering::Relaxed);
        let tmp = std::env::temp_dir().join(format!("logiq-check-{}-{}", std::process::id(), n));
        let _ = std::fs::remove_dir_all(&tmp);
        let out_dir = tmp.join("out");
        std::fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;

        // Unsaved editors stand in for their files: same name, in a folder of their own.
        let mut by_key: std::collections::HashMap<String, &Buffer> = std::collections::HashMap::new();
        for b in &buffers {
            by_key.insert(path_key(&b.path), b);
        }
        let mut back: std::collections::HashMap<String, String> = std::collections::HashMap::new();
        let mut list = String::new();
        for (i, f) in files.iter().enumerate() {
            let original = f.to_string_lossy().to_string();
            let source = match by_key.get(&path_key(&original)) {
                Some(b) => {
                    let dir = tmp.join("src").join(i.to_string());
                    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
                    let copy = dir.join(f.file_name().unwrap_or_default());
                    std::fs::write(&copy, &b.text).map_err(|e| e.to_string())?;
                    back.insert(path_key(&copy.to_string_lossy()), original.clone());
                    copy
                }
                None => f.clone(),
            };
            list.push_str(&format!("\"{}\"\n", source.to_string_lossy().replace('\\', "/")));
        }
        let argfile = tmp.join("files.txt");
        std::fs::write(&argfile, list).map_err(|e| e.to_string())?;

        // The project's own libraries; not `out`, whose old classes would hide a class that is gone.
        let sep = if cfg!(windows) { ";" } else { ":" };
        let mut cp = vec![out_dir.to_string_lossy().to_string()];
        if root.join("lib").is_dir() {
            cp.push(root.join("lib").join("*").to_string_lossy().to_string());
        }
        let output = no_window(
            Command::new(java_bin(&jdk_home, "javac"))
                .current_dir(&root)
                .args(["-J-Duser.language=en", "-J-Dstdout.encoding=UTF-8", "-J-Dstderr.encoding=UTF-8"])
                .args(["-encoding", "UTF-8", "-proc:none", "-Xlint:unchecked,deprecation", "-Xmaxerrs", "500"])
                .arg("-d")
                .arg(&out_dir)
                .arg("-cp")
                .arg(cp.join(sep))
                .args(javafx_args(&root))
                .arg(format!("@{}", argfile.to_string_lossy())),
        )
        .output();
        let _ = std::fs::remove_dir_all(&tmp);
        let output = output.map_err(|e| e.to_string())?;
        let text = format!("{}{}", crate::fs::decode(&output.stdout), crate::fs::decode(&output.stderr)).replace("\r\n", "\n");
        let mut found = parse_javac(&text);
        for d in &mut found {
            if let Some(original) = back.get(&path_key(&d.path)) {
                d.path = original.clone();
            }
        }
        Ok(Some(found))
    })
    .await
    .map_err(|e| e.to_string())?
}

// ----- Running ----------------------------------------------------------------

struct Running {
    id: u32,
    child: Arc<Mutex<Child>>,
    stdin: Option<ChildStdin>,
}

#[derive(Default)]
pub struct Runner {
    current: Mutex<Option<Running>>,
    next: AtomicU32,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct OutputEvent {
    run_id: u32,
    stream: &'static str,
    text: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ExitEvent {
    run_id: u32,
    code: Option<i32>,
    duration_ms: u64,
}

/// Turns a byte stream into text without splitting a character across reads.
#[derive(Default)]
pub struct Utf8Stream(Vec<u8>);

impl Utf8Stream {
    pub fn push(&mut self, bytes: &[u8]) -> String {
        self.0.extend_from_slice(bytes);
        match std::str::from_utf8(&self.0) {
            Ok(s) => {
                let s = s.to_string();
                self.0.clear();
                s
            }
            Err(e) if e.error_len().is_none() => {
                // The tail is the start of a character still to come.
                let valid = e.valid_up_to();
                let s = String::from_utf8_lossy(&self.0[..valid]).into_owned();
                self.0.drain(..valid);
                s
            }
            Err(_) => {
                let s = String::from_utf8_lossy(&self.0).into_owned();
                self.0.clear();
                s
            }
        }
    }
}

fn pump(app: AppHandle, run_id: u32, stream: &'static str, mut source: impl Read + Send + 'static) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        let mut text = Utf8Stream::default();
        loop {
            match source.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let s = text.push(&buf[..n]).replace("\r\n", "\n");
                    if !s.is_empty() {
                        let _ = app.emit("run-output", OutputEvent { run_id, stream, text: s });
                    }
                }
            }
        }
    })
}

pub(crate) fn start(app: AppHandle, runner: &Runner, mut cmd: Command) -> Result<u32, String> {
    stop_current(runner);
    let id = runner.next.fetch_add(1, Ordering::SeqCst) + 1;
    no_window(&mut cmd).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let started = Instant::now();
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let stdin = child.stdin.take();
    let child = Arc::new(Mutex::new(child));
    let readers: Vec<_> = [
        stdout.map(|s| pump(app.clone(), id, "stdout", s)),
        stderr.map(|s| pump(app.clone(), id, "stderr", s)),
    ]
    .into_iter()
    .flatten()
    .collect();
    let waiter = child.clone();
    std::thread::spawn(move || {
        let code = loop {
            let status = waiter.lock().ok().and_then(|mut c| c.try_wait().ok()).flatten();
            if let Some(s) = status {
                break s.code();
            }
            std::thread::sleep(Duration::from_millis(25));
        };
        // Let the last output arrive before saying the program ended.
        for r in readers {
            let _ = r.join();
        }
        let _ = app.emit("run-exit", ExitEvent { run_id: id, code, duration_ms: started.elapsed().as_millis() as u64 });
    });
    *runner.current.lock().map_err(|e| e.to_string())? = Some(Running { id, child, stdin });
    Ok(id)
}

fn stop_current(runner: &Runner) {
    if let Ok(mut slot) = runner.current.lock() {
        if let Some(r) = slot.take() {
            drop(r.stdin);
            if let Ok(mut c) = r.child.lock() {
                let _ = c.kill();
            }
        }
    }
}

/// Runs a compiled class from `<root>/out`; returns the run's id.
#[tauri::command]
pub fn run_java(
    app: AppHandle,
    runner: State<Runner>,
    root: String,
    main_class: String,
    jdk_home: Option<String>,
    args: Vec<String>,
    vm_options: Option<String>,
) -> Result<u32, String> {
    let root = PathBuf::from(root);
    let out = root.join("out");
    let mut cmd = Command::new(java_bin(&jdk_home, "java"));
    cmd.current_dir(&root)
        .args(["-Dfile.encoding=UTF-8", "-Dstdout.encoding=UTF-8", "-Dstderr.encoding=UTF-8", "-Dsun.stdout.encoding=UTF-8"])
        .args(split_options(vm_options.as_deref().unwrap_or("")))
        .args(javafx_run_args(&root, &jdk_home))
        .arg("-cp")
        .arg(class_path(&root, &out))
        .arg(&main_class)
        .args(args);
    start(app, &runner, cmd)
}

/// Splits JVM options like a shell: spaces separate, double quotes group.
pub fn split_options(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut quoted = false;
    let mut has = false;
    for c in s.chars() {
        match c {
            '"' => {
                quoted = !quoted;
                has = true;
            }
            c if c.is_whitespace() && !quoted => {
                if has || !cur.is_empty() {
                    out.push(std::mem::take(&mut cur));
                }
                has = false;
            }
            c => cur.push(c),
        }
    }
    if has || !cur.is_empty() {
        out.push(cur);
    }
    out
}

/// Runs a script with Node.js; returns the run's id.
#[tauri::command]
pub fn run_node(app: AppHandle, runner: State<Runner>, file: String, node: Option<String>) -> Result<u32, String> {
    let node = node.filter(|n| !n.is_empty()).unwrap_or_else(|| exe("node"));
    let path = PathBuf::from(&file);
    let mut cmd = Command::new(node);
    if let Some(dir) = path.parent() {
        cmd.current_dir(dir);
    }
    cmd.arg(&path);
    start(app, &runner, cmd).map_err(|e| {
        if e.contains("program not found") || e.contains("cannot find") {
            "Node.js was not found. Install it from nodejs.org to run JavaScript files.".to_string()
        } else {
            e
        }
    })
}

/// Sends a line of keyboard input to the running program.
#[tauri::command]
pub fn run_stdin(runner: State<Runner>, run_id: u32, text: String) -> Result<(), String> {
    let mut slot = runner.current.lock().map_err(|e| e.to_string())?;
    let Some(r) = slot.as_mut().filter(|r| r.id == run_id) else {
        return Err("The program has ended.".into());
    };
    let stdin = r.stdin.as_mut().ok_or("The program's input is closed.")?;
    stdin.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
    stdin.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn run_stop(runner: State<Runner>) {
    stop_current(&runner);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn javafx_goes_on_the_module_path_when_the_project_has_it() {
        let dir = std::env::temp_dir().join(format!("logiq-fx-args-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("lib")).unwrap();
        assert!(javafx_args(&dir).is_empty());
        assert_eq!(javafx_options(&dir, &None), "");
        std::fs::create_dir_all(dir.join("lib").join("javafx")).unwrap();
        // An empty folder isn't JavaFX yet.
        assert!(javafx_dir(&dir).is_none());
        std::fs::write(dir.join("lib").join("javafx").join("javafx-base-21-win.jar"), b"PK").unwrap();
        let args = javafx_args(&dir);
        assert_eq!(args[0], "--module-path");
        assert!(args[1].ends_with("javafx"));
        assert_eq!(&args[2..], ["--add-modules", "javafx.controls,javafx.fxml"]);
        let run = javafx_run_args(&dir, &None);
        assert!(run.contains(&"--enable-native-access=javafx.graphics".to_string()));
        assert!(javafx_options(&dir, &None).starts_with("--module-path "));
        // Not on the class path as well: lib/* doesn't reach into lib/javafx.
        assert!(!class_path(&dir, &dir.join("out")).contains("javafx"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn resources_are_copied_beside_their_classes() {
        let dir = std::env::temp_dir().join(format!("logiq-resources-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let pkg = dir.join("src").join("app");
        std::fs::create_dir_all(&pkg).unwrap();
        std::fs::write(pkg.join("Hello.java"), "package app;\npublic class Hello {}\n").unwrap();
        std::fs::write(pkg.join("Hello.fxml"), "<AnchorPane/>").unwrap();
        std::fs::write(pkg.join("style.css"), ".root {}").unwrap();
        std::fs::create_dir_all(dir.join("src").join("images")).unwrap();
        std::fs::write(dir.join("src").join("images").join("logo.png"), [137u8, 80, 78, 71]).unwrap();
        std::fs::write(dir.join("README.md"), "not a resource").unwrap();
        let out = dir.join("out");
        assert_eq!(copy_resources(&dir, &out), 3);
        assert!(out.join("app").join("Hello.fxml").is_file());
        assert!(out.join("app").join("style.css").is_file());
        // No source beside it: where it is under src.
        assert!(out.join("images").join("logo.png").is_file());
        assert!(!out.join("README.md").exists());
        // Already there and not changed: not copied again.
        assert_eq!(copy_resources(&dir, &out), 0);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn reads_javac_diagnostics() {
        let out = "C:\\p\\Main.java:5: error: cannot find symbol\n        x = 3;\n        ^\n  symbol:   variable x\n  location: class Main\nC:\\p\\Shape.java:2: warning: [deprecation] Date(int,int,int) in Date has been deprecated\n    java.util.Date d = new java.util.Date(1, 2, 3);\n                       ^\n1 error\n1 warning\n";
        let d = parse_javac(out);
        assert_eq!(d.len(), 2);
        assert_eq!(d[0].path, "C:\\p\\Main.java");
        assert_eq!((d[0].line, d[0].column), (5, 9));
        assert_eq!(d[0].severity, "error");
        assert_eq!(d[0].message, "cannot find symbol\nsymbol:   variable x\nlocation: class Main");
        assert_eq!(d[1].severity, "warning");
        assert_eq!(d[1].column, 24);
    }

    #[test]
    fn utf8_split_across_reads() {
        let mut s = Utf8Stream::default();
        let bytes = "Grüße".as_bytes();
        let a = s.push(&bytes[..3]);
        let b = s.push(&bytes[3..]);
        assert_eq!(format!("{a}{b}"), "Grüße");
        assert_eq!(a, "Gr");
    }

    #[test]
    fn splits_options() {
        assert_eq!(split_options(r#" -Xmx256m  -Dname="a b" "#), vec!["-Xmx256m", "-Dname=a b"]);
        assert!(split_options("").is_empty());
    }

    #[test]
    fn java_versions() {
        assert_eq!(parse_major("1.8.0_392"), 8);
        assert_eq!(parse_major("21.0.2"), 21);
        assert_eq!(parse_major("27"), 27);
    }

    /// Compiles and runs a real program when a JDK is installed.
    #[test]
    fn compiles_with_installed_jdk() {
        if detect_jdks().is_empty() {
            return;
        }
        let dir = std::env::temp_dir().join(format!("logiq-javac-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("Main.java"), "public class Main { public static void main(String[] a) { int x = \"s\"; } }").unwrap();
        let r = tauri::async_runtime::block_on(java_compile(dir.to_string_lossy().to_string(), None)).unwrap();
        assert!(!r.ok);
        assert_eq!(r.diagnostics.len(), 1, "{}", r.output);
        assert_eq!(r.diagnostics[0].line, 1);
        std::fs::write(dir.join("Main.java"), "public class Main { public static void main(String[] a) { System.out.println(\"Grüße\"); } }").unwrap();
        let r = tauri::async_runtime::block_on(java_compile(dir.to_string_lossy().to_string(), None)).unwrap();
        assert!(r.ok, "{}", r.output);
        assert!(dir.join("out").join("Main.class").is_file());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn checks_unsaved_text_without_touching_out() {
        if detect_jdks().is_empty() {
            return;
        }
        let dir = std::env::temp_dir().join(format!("logiq-check-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        // On disk: an error in Shape.java, which Main uses.
        std::fs::write(dir.join("Shape.java"), "public class Shape { int area() { return \"x\"; } }").unwrap();
        std::fs::write(dir.join("Main.java"), "public class Main { public static void main(String[] a) { new Shape().area(); } }").unwrap();
        let shape = dir.join("Shape.java").to_string_lossy().to_string();
        let root = dir.to_string_lossy().to_string();
        let check = |buffers: Vec<Buffer>| tauri::async_runtime::block_on(java_check(root.clone(), None, buffers)).unwrap().unwrap();

        let found = check(vec![]);
        assert_eq!(found.len(), 1, "{:?}", found);
        assert_eq!(path_key(&found[0].path), path_key(&shape));

        // The editor has fixed it but not saved: no problem.
        assert!(check(vec![Buffer { path: shape.clone(), text: "public class Shape { int area() { return 1; } }".into() }]).is_empty());

        // An unsaved new error is reported for the real file, at its line.
        let found = check(vec![Buffer { path: shape.clone(), text: "public class Shape {
  int area() { return y; }
}".into() }]);
        assert_eq!(found.len(), 1, "{:?}", found);
        assert_eq!(path_key(&found[0].path), path_key(&shape));
        assert_eq!(found[0].line, 2);
        assert!(found[0].message.starts_with("cannot find symbol"));
        assert!(!dir.join("out").exists());
        let _ = std::fs::remove_dir_all(dir);
    }
}
