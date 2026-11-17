//! The tools of the languages beyond Java and the web: Python and its
//! virtual environments, C and C++ compilers, PHP, Kotlin and their language
//! servers. This side finds them where their installers put them, runs them
//! once and hands back the output (`tool_exec`), starts programs with live
//! output in the run panel (`run_program`), compiles with gcc-, clang-,
//! kotlinc- or MSVC-style messages (`native_compile`), and runs PHP's
//! built-in web server for the preview.

use crate::runner::{self, no_window, CompileResult, Diagnostic, Runner};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, State};

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Tool {
    pub path: String,
    pub version: String,
    /// Where it was found, for the picker: "PATH", "LLVM", ".venv"…
    pub source: String,
}

fn env_dir(var: &str) -> Option<PathBuf> {
    std::env::var_os(var).map(PathBuf::from)
}

/// Folders matching `prefix*` inside `dir`, newest name first (Python314 before Python313).
fn versioned_dirs(dir: &Path, prefix: &str) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = std::fs::read_dir(dir)
        .map(|r| r.flatten().map(|e| e.path()).filter(|p| p.is_dir() && p.file_name().is_some_and(|n| n.to_string_lossy().to_lowercase().starts_with(&prefix.to_lowercase()))).collect())
        .unwrap_or_default();
    out.sort_by_key(|p| std::cmp::Reverse(natural_key(p)));
    out
}

fn natural_key(p: &Path) -> Vec<u64> {
    let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    regex::Regex::new(r"\d+").unwrap().find_iter(&name).filter_map(|m| m.as_str().parse().ok()).collect()
}

/// The executable names a tool goes by, and the folders besides the PATH it is installed to.
fn candidates(kind: &str) -> (Vec<&'static str>, Vec<(PathBuf, &'static str)>) {
    let mut dirs: Vec<(PathBuf, &'static str)> = Vec::new();
    let windows = cfg!(windows);
    let local = env_dir("LOCALAPPDATA").unwrap_or_default();
    let program_files = env_dir("ProgramFiles").unwrap_or_else(|| PathBuf::from(r"C:\Program Files"));
    let user = env_dir("USERPROFILE").unwrap_or_default();
    let npm = env_dir("APPDATA").map(|a| a.join("npm")).unwrap_or_default();
    let scoop = user.join("scoop").join("shims");
    let llvm = program_files.join("LLVM").join("bin");
    // Programs winget installs from an archive (WinLibs, PHP) stay in its package folder.
    let winget = local.join("Microsoft").join("WinGet");
    let winget_packages = |prefix: &str, sub: &[&str], source: &'static str| -> Vec<(PathBuf, &'static str)> {
        let mut v = Vec::new();
        if let Ok(rd) = std::fs::read_dir(winget.join("Packages")) {
            for e in rd.flatten() {
                if e.file_name().to_string_lossy().starts_with(prefix) {
                    let mut p = e.path();
                    for s in sub {
                        p = p.join(s);
                    }
                    v.push((p, source));
                }
            }
        }
        v
    };
    let gcc_dirs = || -> Vec<(PathBuf, &'static str)> {
        vec![
            (PathBuf::from(r"C:\msys64\ucrt64\bin"), "MSYS2"),
            (PathBuf::from(r"C:\msys64\mingw64\bin"), "MSYS2"),
            (PathBuf::from(r"C:\msys64\clang64\bin"), "MSYS2"),
            (PathBuf::from(r"C:\mingw64\bin"), "MinGW"),
            (PathBuf::from(r"C:\MinGW\bin"), "MinGW"),
            (PathBuf::from(r"C:\TDM-GCC-64\bin"), "TDM-GCC"),
            (PathBuf::from(r"C:\ProgramData\chocolatey\bin"), "Chocolatey"),
        ]
    };
    let python_dirs = || -> Vec<(PathBuf, &'static str)> {
        let mut v = Vec::new();
        for base in [local.join("Programs").join("Python"), PathBuf::from(r"C:\"), program_files.clone()] {
            for d in versioned_dirs(&base, "Python") {
                v.push((d.join("Scripts"), "Python"));
                v.push((d, "Python"));
            }
        }
        v
    };
    let names: Vec<&'static str> = match kind {
        "python" => {
            dirs.extend(python_dirs().into_iter().filter(|(d, _)| !d.ends_with("Scripts")));
            if windows {
                vec!["python"]
            } else {
                vec!["python3", "python"]
            }
        }
        "cc" | "cxx" => {
            dirs.push((llvm, "LLVM"));
            dirs.extend(gcc_dirs());
            dirs.extend(winget_packages("BrechtSanders.WinLibs", &["mingw64", "bin"], "WinLibs"));
            if kind == "cc" {
                vec!["clang", "gcc", "cc"]
            } else {
                vec!["clang++", "g++", "c++"]
            }
        }
        "clangd" | "clang-format" => {
            dirs.push((llvm, "LLVM"));
            dirs.extend(gcc_dirs());
            dirs.extend(winget_packages("BrechtSanders.WinLibs", &["mingw64", "bin"], "WinLibs"));
            if kind == "clangd" {
                vec!["clangd"]
            } else {
                vec!["clang-format"]
            }
        }
        "php" => {
            dirs.push((PathBuf::from(r"C:\php"), "PHP"));
            dirs.push((PathBuf::from(r"C:\xampp\php"), "XAMPP"));
            for d in versioned_dirs(Path::new(r"C:\tools"), "php") {
                dirs.push((d, "PHP"));
            }
            dirs.push((scoop.clone(), "Scoop"));
            dirs.extend(winget_packages("PHP.PHP.", &[], "PHP"));
            dirs.push((winget.join("Links"), "winget"));
            vec!["php"]
        }
        "kotlinc" => {
            dirs.push((PathBuf::from(r"C:\kotlinc\bin"), "Kotlin"));
            dirs.push((local.join("Programs").join("kotlinc").join("bin"), "Kotlin"));
            dirs.push((program_files.join("kotlinc").join("bin"), "Kotlin"));
            dirs.push((scoop.clone(), "Scoop"));
            vec!["kotlinc"]
        }
        "python-lsp" => {
            dirs.extend(python_dirs().into_iter().filter(|(d, _)| d.ends_with("Scripts")));
            dirs.push((npm.clone(), "npm"));
            vec!["basedpyright-langserver", "pyright-langserver", "pylsp", "jedi-language-server"]
        }
        "php-lsp" => {
            dirs.push((npm.clone(), "npm"));
            vec!["intelephense", "phpactor"]
        }
        "kotlin-lsp" => {
            dirs.push((scoop, "Scoop"));
            vec!["kotlin-language-server"]
        }
        _ => vec![],
    };
    (names, dirs)
}

/// The file names one program name can have here.
fn file_names(name: &str) -> Vec<String> {
    if cfg!(windows) {
        ["exe", "cmd", "bat"].iter().map(|e| format!("{name}.{e}")).collect()
    } else {
        vec![name.to_string()]
    }
}

/// Windows' app-execution aliases for Python open the Microsoft Store when Python isn't installed from there.
fn is_store_alias(p: &Path) -> bool {
    p.to_string_lossy().to_lowercase().contains(r"\microsoft\windowsapps\")
}

/// Runs a program and gives back what it printed, or None when it didn't finish in time.
pub fn run_captured(cmd: &mut Command, input: Option<&str>, timeout: Duration) -> Option<(i32, String, String)> {
    no_window(cmd).stdin(if input.is_some() { Stdio::piped() } else { Stdio::null() }).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = cmd.spawn().ok()?;
    if let (Some(text), Some(mut stdin)) = (input, child.stdin.take()) {
        let text = text.to_string();
        std::thread::spawn(move || {
            let _ = stdin.write_all(text.as_bytes());
        });
    }
    let mut out = child.stdout.take()?;
    let mut errs = child.stderr.take()?;
    let reader = std::thread::spawn(move || {
        let mut b = Vec::new();
        let _ = out.read_to_end(&mut b);
        b
    });
    let err_reader = std::thread::spawn(move || {
        let mut b = Vec::new();
        let _ = errs.read_to_end(&mut b);
        b
    });
    let started = Instant::now();
    let code = loop {
        if let Ok(Some(status)) = child.try_wait() {
            break status.code().unwrap_or(-1);
        }
        if started.elapsed() > timeout {
            let _ = child.kill();
            let _ = child.wait();
            return None;
        }
        std::thread::sleep(Duration::from_millis(15));
    };
    let stdout = String::from_utf8_lossy(&reader.join().unwrap_or_default()).replace("\r\n", "\n");
    let stderr = String::from_utf8_lossy(&err_reader.join().unwrap_or_default()).replace("\r\n", "\n");
    Some((code, stdout, stderr))
}

/// The version number in a tool's `--version` output: "clang version 23.1.3 (…)" → 23.1.3.
pub fn parse_version(text: &str) -> String {
    let no_parens = regex::Regex::new(r"\([^)]*\)").unwrap().replace_all(text, " ");
    regex::Regex::new(r"\d+\.\d+(\.\d+)?").unwrap().find(&no_parens).map(|m| m.as_str().to_string()).unwrap_or_default()
}

fn version_of(path: &Path, kind: &str) -> Option<String> {
    let flag = if kind == "kotlinc" { "-version" } else { "--version" };
    let (code, out, errs) = run_captured(Command::new(path).arg(flag), None, Duration::from_secs(if kind == "kotlinc" { 30 } else { 6 }))?;
    let text = if out.trim().is_empty() { errs } else { out };
    if code != 0 && text.trim().is_empty() {
        return None;
    }
    Some(parse_version(text.lines().find(|l| !l.trim().is_empty()).unwrap_or("")))
}

/// The virtual environments in a project folder: `.venv`, `venv`, `env` or any folder with a `pyvenv.cfg`.
pub fn venvs(root: &Path) -> Vec<(PathBuf, String)> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(root) else { return out };
    let mut dirs: Vec<PathBuf> = entries.flatten().map(|e| e.path()).filter(|p| p.join("pyvenv.cfg").is_file()).collect();
    dirs.sort_by_key(|d| {
        let n = d.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        (![".venv", "venv", "env", ".env"].contains(&n.as_str()), n)
    });
    for d in dirs {
        let exe = if cfg!(windows) { d.join("Scripts").join("python.exe") } else { d.join("bin").join("python") };
        if exe.is_file() {
            out.push((exe, d.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()));
        }
    }
    out
}

fn find(kind: &str, root: Option<&Path>, with_versions: bool) -> Vec<Tool> {
    let (names, dirs) = candidates(kind);
    let mut found: Vec<(PathBuf, String)> = Vec::new();
    // A project's own virtual environment comes first, for Python and its language servers.
    if let Some(root) = root {
        for (python, name) in venvs(root) {
            if kind == "python" {
                found.push((python, name));
            } else if kind == "python-lsp" {
                if let Some(scripts) = python.parent() {
                    for n in &names {
                        for f in file_names(n) {
                            if scripts.join(&f).is_file() {
                                found.push((scripts.join(f), name.clone()));
                            }
                        }
                    }
                }
            }
        }
    }
    let path_dirs: Vec<PathBuf> = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
    for n in &names {
        for d in &path_dirs {
            for f in file_names(n) {
                found.push((d.join(f), "PATH".into()));
            }
        }
        for (d, source) in &dirs {
            for f in file_names(n) {
                found.push((d.join(f), (*source).into()));
            }
        }
    }
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for (p, source) in found {
        if !p.is_file() || is_store_alias(&p) {
            continue;
        }
        let key = std::fs::canonicalize(&p).unwrap_or(p.clone()).to_string_lossy().to_lowercase();
        if !seen.insert(key) {
            continue;
        }
        let version = if with_versions {
            match version_of(&p, kind) {
                Some(v) => v,
                None => continue,
            }
        } else {
            String::new()
        };
        out.push(Tool { path: p.to_string_lossy().to_string(), version, source });
    }
    out
}

/// Finds a kind of tool: "python", "cc", "cxx", "php", "kotlinc", "clangd", "clang-format",
/// "python-lsp", "php-lsp" or "kotlin-lsp". Compilers and interpreters come with their version.
#[tauri::command]
pub async fn tools_find(kind: String, root: Option<String>) -> Vec<Tool> {
    tauri::async_runtime::spawn_blocking(move || {
        let versions = !kind.ends_with("-lsp") && kind != "clangd" && kind != "clang-format";
        find(&kind, root.as_deref().map(Path::new), versions)
    })
    .await
    .unwrap_or_default()
}

#[derive(Serialize)]
pub struct ExecResult {
    code: i32,
    stdout: String,
    stderr: String,
}

/// Runs a tool once, with optional text on its input, and returns what it printed.
#[tauri::command]
pub async fn tool_exec(program: String, args: Vec<String>, cwd: Option<String>, input: Option<String>, env: Option<HashMap<String, String>>, timeout_ms: Option<u64>) -> Result<ExecResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = Command::new(&program);
        cmd.args(&args);
        if let Some(dir) = cwd.as_deref().filter(|d| Path::new(d).is_dir()) {
            cmd.current_dir(dir);
        }
        for (k, v) in env.unwrap_or_default() {
            cmd.env(k, v);
        }
        match run_captured(&mut cmd, input.as_deref(), Duration::from_millis(timeout_ms.unwrap_or(60_000))) {
            Some((code, stdout, stderr)) => Ok(ExecResult { code, stdout, stderr }),
            None => {
                if Path::new(&program).is_absolute() && !Path::new(&program).is_file() {
                    Err(format!("{program} wasn't found."))
                } else {
                    Err(format!("{} didn't finish or couldn't be started.", Path::new(&program).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or(program)))
                }
            }
        }
    })
    .await
    .map_err(err)?
}

/// Starts a program with its output in the run panel and keyboard input passed on; returns the run's id.
#[tauri::command]
pub fn run_program(app: AppHandle, runner: State<Runner>, program: String, args: Vec<String>, cwd: Option<String>, env: Option<HashMap<String, String>>) -> Result<u32, String> {
    let mut cmd = Command::new(&program);
    cmd.args(&args);
    if let Some(dir) = cwd.as_deref().filter(|d| Path::new(d).is_dir()) {
        cmd.current_dir(dir);
    }
    for (k, v) in env.unwrap_or_default() {
        cmd.env(k, v);
    }
    runner::start(app, &runner, cmd).map_err(|e| {
        if e.contains("program not found") || e.contains("cannot find") || e.contains("os error 2") {
            format!("{} wasn't found.", Path::new(&program).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or(program))
        } else {
            e
        }
    })
}

/// Reads compiler messages in the forms gcc, clang and kotlinc write them
/// (`file:12:5: error: message`, `note:` lines added to the one before) and
/// the form of MSVC (`file(12,5): error C2065: message`). Relative paths are
/// taken from `cwd`.
pub fn parse_gcc(output: &str, cwd: &Path) -> Vec<Diagnostic> {
    let gcc = regex::Regex::new(r"^(.+?):(\d+):(?:(\d+):)? (fatal error|error|warning|note|Fehler|Warnung): (.*)$").unwrap();
    let msvc = regex::Regex::new(r"^(.+?)\((\d+)(?:,(\d+))?\)\s?: (fatal error|error|warning) [A-Z]+\d+: (.*)$").unwrap();
    let mut out: Vec<Diagnostic> = Vec::new();
    let mut seen = HashSet::new();
    for line in output.lines() {
        let Some(c) = gcc.captures(line).or_else(|| msvc.captures(line)) else { continue };
        let path = {
            let p = PathBuf::from(c[1].trim());
            if p.is_absolute() {
                p
            } else {
                cwd.join(p)
            }
        };
        let severity = match &c[4] {
            "note" => {
                if let Some(last) = out.last_mut() {
                    last.add_detail(c[5].trim());
                }
                continue;
            }
            "warning" | "Warnung" => "warning",
            _ => "error",
        };
        let d = Diagnostic::new(path.to_string_lossy().to_string(), c[2].parse().unwrap_or(1), c.get(3).and_then(|m| m.as_str().parse().ok()).unwrap_or(0), severity, c[5].trim());
        if seen.insert(d.key()) {
            out.push(d);
        }
    }
    out
}

/// Compiles with a native compiler (gcc, clang, kotlinc…) and reads its messages.
#[tauri::command]
pub async fn native_compile(program: String, args: Vec<String>, cwd: String, files: usize, env: Option<HashMap<String, String>>) -> Result<CompileResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let started = Instant::now();
        let mut cmd = Command::new(&program);
        cmd.args(&args).current_dir(&cwd);
        for (k, v) in env.unwrap_or_default() {
            cmd.env(k, v);
        }
        let (code, stdout, stderr) =
            run_captured(&mut cmd, None, Duration::from_secs(600)).ok_or_else(|| format!("{} couldn't be started or took too long.", Path::new(&program).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or(program.clone())))?;
        let output = [stderr.trim_end(), stdout.trim_end()].iter().filter(|s| !s.is_empty()).copied().collect::<Vec<_>>().join("\n");
        let diagnostics = parse_gcc(&output, Path::new(&cwd));
        Ok(CompileResult::new(code == 0, diagnostics, output, files, started.elapsed().as_millis() as u64))
    })
    .await
    .map_err(err)?
}

// ----- PHP's built-in web server --------------------------------------------------------------

#[derive(Default)]
pub struct PhpServer(Mutex<Option<(Child, String, u16)>>);

fn free_port() -> Result<u16, String> {
    Ok(TcpListener::bind("127.0.0.1:0").map_err(err)?.local_addr().map_err(err)?.port())
}

/// Serves the folder with `php -S` on a free local port (the same server again for the same folder); returns the port.
#[tauri::command]
pub async fn php_serve(state: State<'_, PhpServer>, root: String, php: String) -> Result<u16, String> {
    {
        let mut slot = state.0.lock().map_err(err)?;
        if let Some((child, r, port)) = slot.as_mut() {
            if *r == root && matches!(child.try_wait(), Ok(None)) {
                return Ok(*port);
            }
            let _ = child.kill();
        }
        *slot = None;
    }
    let port = free_port()?;
    let mut cmd = Command::new(&php);
    cmd.args(["-S", &format!("127.0.0.1:{port}"), "-t", &root]).current_dir(&root).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    let mut child = no_window(&mut cmd).spawn().map_err(|e| format!("PHP couldn't be started: {e}"))?;
    let started = Instant::now();
    loop {
        if TcpStream::connect_timeout(&format!("127.0.0.1:{port}").parse().map_err(err)?, Duration::from_millis(200)).is_ok() {
            break;
        }
        if let Ok(Some(status)) = child.try_wait() {
            return Err(format!("PHP's web server ended right away ({status})."));
        }
        if started.elapsed() > Duration::from_secs(5) {
            let _ = child.kill();
            return Err("PHP's web server didn't start.".into());
        }
        std::thread::sleep(Duration::from_millis(40));
    }
    *state.0.lock().map_err(err)? = Some((child, root, port));
    Ok(port)
}

#[tauri::command]
pub fn php_serve_stop(state: State<PhpServer>) {
    if let Ok(mut slot) = state.0.lock() {
        if let Some((mut child, _, _)) = slot.take() {
            let _ = child.kill();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_gcc_clang_and_msvc_messages() {
        let cwd = Path::new(r"C:\p");
        let out = "In file included from main.c:1:\n\
C:\\p\\main.c:4:9: error: use of undeclared identifier 'x'\n\
    4 |     int y = x;\n\
      |             ^\n\
C:\\p\\main.c:4:9: note: did you mean 'y'?\n\
util.h:2:1: warning: type specifier missing [-Wimplicit-int]\n\
main.kt:3:5: error: unresolved reference 'foo'.\n\
src\\a.cpp(12,7): error C2065: 'z': undeclared identifier\n\
lld-link: error: undefined symbol: helper\n";
        let d = parse_gcc(out, cwd);
        assert_eq!(d.len(), 4, "{d:?}");
        assert_eq!(d[0], Diagnostic::new(r"C:\p\main.c".into(), 4, 9, "error", "use of undeclared identifier 'x'\ndid you mean 'y'?"));
        assert_eq!(d[1], Diagnostic::new(r"C:\p\util.h".into(), 2, 1, "warning", "type specifier missing [-Wimplicit-int]"));
        assert_eq!(d[2], Diagnostic::new(r"C:\p\main.kt".into(), 3, 5, "error", "unresolved reference 'foo'."));
        assert_eq!(d[3], Diagnostic::new(r"C:\p\src\a.cpp".into(), 12, 7, "error", "'z': undeclared identifier"));
    }

    #[test]
    fn versions() {
        assert_eq!(parse_version("clang version 23.1.3 (https://github.com/llvm/llvm-project 0d26)"), "23.1.3");
        assert_eq!(parse_version("gcc.exe (Rev2, Built by MSYS2 project 1.2) 14.2.0"), "14.2.0");
        assert_eq!(parse_version("Python 3.14.7"), "3.14.7");
        assert_eq!(parse_version("PHP 8.5.11 (cli) (built: Sep 22 2026)"), "8.5.11");
        assert_eq!(parse_version("info: kotlinc-jvm 2.1.0 (JRE 21.0.2)"), "2.1.0");
    }

    #[test]
    fn finds_venvs() {
        let dir = std::env::temp_dir().join(format!("logiq-venv-test-{}", std::process::id()));
        let scripts = if cfg!(windows) { dir.join(".venv").join("Scripts") } else { dir.join(".venv").join("bin") };
        std::fs::create_dir_all(&scripts).unwrap();
        std::fs::write(dir.join(".venv").join("pyvenv.cfg"), "home = x\n").unwrap();
        std::fs::write(scripts.join(if cfg!(windows) { "python.exe" } else { "python" }), "").unwrap();
        std::fs::create_dir_all(dir.join("src")).unwrap();
        let v = venvs(&dir);
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].1, ".venv");
        let _ = std::fs::remove_dir_all(dir);
    }

    /// Compiles and runs a C program with the compiler found here, when there is one.
    #[test]
    fn compiles_c_with_found_compiler() {
        let Some(cc) = find("cc", None, true).into_iter().next() else { return };
        let dir = std::env::temp_dir().join(format!("logiq-cc-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("main.c"), "#include <stdio.h>\nint main(void) {\n    int n = 0;\n    if (scanf(\"%d\", &n) != 1) return 2;\n    printf(\"Grüße %d\\n\", n * 2);\n    return 0;\n}\n").unwrap();
        let exe = dir.join(if cfg!(windows) { "main.exe" } else { "main" });
        let args = vec!["main.c".to_string(), "-o".into(), exe.to_string_lossy().to_string(), "-D_CRT_SECURE_NO_WARNINGS".into()];
        let r = tauri::async_runtime::block_on(native_compile(cc.path.clone(), args.clone(), dir.to_string_lossy().to_string(), 1, None)).unwrap();
        assert!(r.ok, "{}", r.output);
        let (code, out, _) = run_captured(&mut Command::new(&exe), Some("21\n"), Duration::from_secs(10)).unwrap();
        assert_eq!(code, 0);
        assert_eq!(out, "Grüße 42\n");
        std::fs::write(dir.join("main.c"), "int main(void) {\n    return x;\n}\n").unwrap();
        let r = tauri::async_runtime::block_on(native_compile(cc.path, args, dir.to_string_lossy().to_string(), 1, None)).unwrap();
        assert!(!r.ok);
        let json = serde_json::to_value(&r).unwrap();
        assert_eq!(json["diagnostics"][0]["line"], 2, "{}", r.output);
        assert_eq!(json["diagnostics"][0]["column"], 12);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn serves_php() {
        let Some(php) = find("php", None, true).into_iter().next() else { return };
        let dir = std::env::temp_dir().join(format!("logiq-php-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("index.php"), "<?php echo 'Hallo ' . (6 * 7);").unwrap();
        let port = free_port().unwrap();
        let mut child = Command::new(&php.path).args(["-S", &format!("127.0.0.1:{port}"), "-t"]).arg(&dir).stdout(Stdio::null()).stderr(Stdio::null()).spawn().unwrap();
        let started = Instant::now();
        let body = loop {
            if let Ok(resp) = ureq::get(&format!("http://127.0.0.1:{port}/index.php")).call() {
                break resp.into_string().unwrap();
            }
            assert!(started.elapsed() < Duration::from_secs(5));
            std::thread::sleep(Duration::from_millis(50));
        };
        let _ = child.kill();
        assert_eq!(body, "Hallo 42");
        let _ = std::fs::remove_dir_all(dir);
    }
}
