//! The JDK's other tools: a JShell session, runnable JARs, Javadoc, and
//! JUnit (whose console launcher can be downloaded into the project's lib).

use crate::runner::{class_path, java_bin, no_window, Utf8Stream};
use serde::Serialize;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

// ----- JShell ---------------------------------------------------------------------------

struct Shell {
    child: Child,
    stdin: ChildStdin,
}

#[derive(Default)]
pub struct JShell(Mutex<Option<Shell>>);

fn pump(app: AppHandle, mut source: impl Read + Send + 'static) {
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        let mut text = Utf8Stream::default();
        while let Ok(n) = source.read(&mut buf) {
            if n == 0 {
                break;
            }
            let s = text.push(&buf[..n]).replace("\r\n", "\n");
            if !s.is_empty() {
                let _ = app.emit("jshell-output", s);
            }
        }
        let _ = app.emit("jshell-exit", ());
    });
}

/// Starts JShell with the project's compiled classes on the class path.
#[tauri::command]
pub fn jshell_start(app: AppHandle, state: State<JShell>, root: String, jdk_home: Option<String>) -> Result<(), String> {
    jshell_stop(state.clone());
    let root = PathBuf::from(root);
    let mut cmd = Command::new(java_bin(&jdk_home, "jshell"));
    cmd.current_dir(&root)
        .args(["-J-Dfile.encoding=UTF-8", "-J-Dstdout.encoding=UTF-8", "-J-Dstdin.encoding=UTF-8", "-J-Duser.language=en"])
        .args(["-R-Dfile.encoding=UTF-8", "-R-Dstdout.encoding=UTF-8", "-R-Dstderr.encoding=UTF-8"])
        .arg("--class-path")
        .arg(class_path(&root, &root.join("out")))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = no_window(&mut cmd).spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "JShell was not found. It comes with every JDK from Java 9 on.".to_string()
        } else {
            e.to_string()
        }
    })?;
    pump(app.clone(), child.stdout.take().ok_or("no output")?);
    pump(app, child.stderr.take().ok_or("no error output")?);
    let stdin = child.stdin.take().ok_or("no input")?;
    *state.0.lock().map_err(err)? = Some(Shell { child, stdin });
    Ok(())
}

#[tauri::command]
pub fn jshell_send(state: State<JShell>, text: String) -> Result<(), String> {
    let mut slot = state.0.lock().map_err(err)?;
    let s = slot.as_mut().ok_or("JShell isn't running.")?;
    s.stdin.write_all(text.as_bytes()).map_err(err)?;
    s.stdin.flush().map_err(err)
}

#[tauri::command]
pub fn jshell_stop(state: State<JShell>) {
    if let Ok(mut slot) = state.0.lock() {
        if let Some(mut s) = slot.take() {
            let _ = s.stdin.write_all(b"/exit\n");
            let _ = s.child.kill();
        }
    }
}

// ----- JAR and Javadoc ---------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolResult {
    ok: bool,
    output: String,
    /// What was made: the JAR, or Javadoc's index.html.
    path: String,
}

fn jars_in_lib(root: &Path) -> Vec<PathBuf> {
    std::fs::read_dir(root.join("lib"))
        .map(|rd| rd.flatten().map(|e| e.path()).filter(|p| p.extension().map(|e| e.eq_ignore_ascii_case("jar")).unwrap_or(false)).collect())
        .unwrap_or_default()
}

/// Packs `<root>/out` into a JAR that runs `main_class` with `java -jar`. Libraries
/// from `lib` are copied into a `lib` folder beside it and listed in the manifest.
#[tauri::command]
pub async fn jar_export(root: String, jdk_home: Option<String>, main_class: String, dest: String) -> Result<ToolResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = PathBuf::from(root);
        let dest = PathBuf::from(dest);
        let libs = jars_in_lib(&root);
        let manifest = std::env::temp_dir().join(format!("logiq-manifest-{}.txt", std::process::id()));
        let mut text = format!("Main-Class: {main_class}\nCreated-By: Logiq Studio\n");
        if !libs.is_empty() {
            let names: Vec<String> = libs.iter().map(|p| format!("lib/{}", p.file_name().unwrap().to_string_lossy())).collect();
            text.push_str(&format!("Class-Path: {}\n", names.join(" ")));
            let lib_dir = dest.parent().unwrap_or(Path::new(".")).join("lib");
            std::fs::create_dir_all(&lib_dir).map_err(err)?;
            for l in &libs {
                std::fs::copy(l, lib_dir.join(l.file_name().unwrap())).map_err(err)?;
            }
        }
        std::fs::write(&manifest, text).map_err(err)?;
        let _ = std::fs::remove_file(&dest);
        let out = no_window(
            Command::new(java_bin(&jdk_home, "jar"))
                .arg("--create")
                .arg("--file")
                .arg(&dest)
                .arg("--manifest")
                .arg(&manifest)
                .arg("-C")
                .arg(root.join("out"))
                .arg("."),
        )
        .output()
        .map_err(err)?;
        let _ = std::fs::remove_file(&manifest);
        Ok(ToolResult {
            ok: out.status.success(),
            output: format!("{}{}", crate::fs::decode(&out.stdout), crate::fs::decode(&out.stderr)),
            path: dest.to_string_lossy().to_string(),
        })
    })
    .await
    .map_err(err)?
}

/// Writes the Javadoc of every Java file to `<root>/doc`, private members included.
#[tauri::command]
pub async fn javadoc_generate(root: String, jdk_home: Option<String>) -> Result<ToolResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = PathBuf::from(root);
        let mut files = Vec::new();
        crate::fs::walk(&root, 20_000, &mut |p| {
            if p.extension().map(|e| e.eq_ignore_ascii_case("java")).unwrap_or(false) {
                files.push(p.to_path_buf());
            }
        });
        if files.is_empty() {
            return Err("There are no .java files in this folder.".to_string());
        }
        let doc = root.join("doc");
        let argfile = std::env::temp_dir().join(format!("logiq-javadoc-{}.txt", std::process::id()));
        std::fs::write(&argfile, files.iter().map(|f| format!("\"{}\"\n", f.to_string_lossy().replace('\\', "/"))).collect::<String>()).map_err(err)?;
        let out = no_window(
            Command::new(java_bin(&jdk_home, "javadoc"))
                .current_dir(&root)
                .args(["-J-Duser.language=en", "-encoding", "UTF-8", "-docencoding", "UTF-8", "-charset", "UTF-8", "-private", "-quiet", "-Xdoclint:none", "-d"])
                .arg(&doc)
                .arg("-cp")
                .arg(class_path(&root, &root.join("out")))
                .arg(format!("@{}", argfile.to_string_lossy())),
        )
        .output()
        .map_err(err)?;
        let _ = std::fs::remove_file(&argfile);
        Ok(ToolResult {
            ok: out.status.success() && doc.join("index.html").is_file(),
            output: format!("{}{}", crate::fs::decode(&out.stdout), crate::fs::decode(&out.stderr)),
            path: doc.join("index.html").to_string_lossy().to_string(),
        })
    })
    .await
    .map_err(err)?
}

// ----- JUnit ------------------------------------------------------------------------------

pub const JUNIT_VERSION: &str = "1.12.2";

fn junit_name() -> String {
    format!("junit-platform-console-standalone-{JUNIT_VERSION}.jar")
}

/// The JUnit console launcher in the project's lib folder, if there is one.
#[tauri::command]
pub fn junit_find(root: String) -> Option<String> {
    jars_in_lib(Path::new(&root))
        .into_iter()
        .find(|p| p.file_name().map(|n| n.to_string_lossy().starts_with("junit-platform-console-standalone")).unwrap_or(false))
        .map(|p| p.to_string_lossy().to_string())
}

/// Downloads the JUnit console launcher from Maven Central into `<root>/lib`.
#[tauri::command]
pub async fn junit_download(root: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let url = format!("https://repo1.maven.org/maven2/org/junit/platform/junit-platform-console-standalone/{JUNIT_VERSION}/{}", junit_name());
        let resp = ureq::get(&url).call().map_err(|e| format!("The download failed: {e}"))?;
        let mut bytes = Vec::new();
        resp.into_reader().take(20 * 1024 * 1024).read_to_end(&mut bytes).map_err(err)?;
        if bytes.len() < 100_000 || &bytes[..2] != b"PK" {
            return Err("The download didn't give a JAR file.".into());
        }
        let lib = Path::new(&root).join("lib");
        std::fs::create_dir_all(&lib).map_err(err)?;
        let path = lib.join(junit_name());
        std::fs::write(&path, bytes).map_err(err)?;
        Ok(path.to_string_lossy().to_string())
    })
    .await
    .map_err(err)?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestRun {
    ok: bool,
    output: String,
    /// The XML report (legacy JUnit format), empty when none was written.
    report: String,
}

/// Runs every test class in `<root>/out` (or one class / one method) with the console launcher.
#[tauri::command]
pub async fn junit_run(root: String, jdk_home: Option<String>, launcher: String, select: Option<String>) -> Result<TestRun, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = PathBuf::from(root);
        let reports = root.join("out").join("test-reports");
        let _ = std::fs::remove_dir_all(&reports);
        let mut cmd = Command::new(java_bin(&jdk_home, "java"));
        cmd.current_dir(&root)
            .args(["-Dfile.encoding=UTF-8", "-Dstdout.encoding=UTF-8", "-Dstderr.encoding=UTF-8", "-jar"])
            .arg(&launcher)
            .arg("execute")
            .arg("--class-path")
            .arg(class_path(&root, &root.join("out")))
            .args(["--disable-banner", "--details=tree", "--details-theme=ascii", "--reports-dir"])
            .arg(&reports);
        match select.as_deref() {
            Some(s) if s.contains('#') => {
                cmd.arg("--select-method").arg(s);
            }
            Some(s) if !s.is_empty() => {
                cmd.arg("--select-class").arg(s);
            }
            _ => {
                cmd.arg("--scan-class-path");
            }
        }
        let out = no_window(&mut cmd).output().map_err(err)?;
        let report = std::fs::read_dir(&reports)
            .ok()
            .and_then(|rd| rd.flatten().map(|e| e.path()).find(|p| p.extension().map(|e| e == "xml").unwrap_or(false)))
            .and_then(|p| std::fs::read_to_string(p).ok())
            .unwrap_or_default();
        Ok(TestRun {
            ok: out.status.success(),
            output: format!("{}{}", crate::fs::decode(&out.stdout), crate::fs::decode(&out.stderr)).replace("\r\n", "\n"),
            report,
        })
    })
    .await
    .map_err(err)?
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Builds a runnable JAR and Javadoc with the installed JDK.
    #[test]
    fn jar_and_javadoc() {
        let Some(jdk) = crate::runner::detect_jdks().into_iter().next() else { return };
        let dir = std::env::temp_dir().join(format!("logiq-tools-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("out")).unwrap();
        std::fs::write(dir.join("Hello.java"), "/** Says hello. */\npublic class Hello {\n    /** Starts. @param args unused */\n    public static void main(String[] args) { System.out.println(\"hi\"); }\n}\n").unwrap();
        let javac = Path::new(&jdk.home).join("bin").join(if cfg!(windows) { "javac.exe" } else { "javac" });
        assert!(Command::new(javac).args(["-encoding", "UTF-8", "-d"]).arg(dir.join("out")).arg(dir.join("Hello.java")).status().unwrap().success());
        let root = dir.to_string_lossy().to_string();
        let jar = dir.join("dist").join("hello.jar");
        std::fs::create_dir_all(jar.parent().unwrap()).unwrap();
        let r = tauri::async_runtime::block_on(jar_export(root.clone(), None, "Hello".into(), jar.to_string_lossy().to_string())).unwrap();
        assert!(r.ok, "{}", r.output);
        let java = Path::new(&jdk.home).join("bin").join(if cfg!(windows) { "java.exe" } else { "java" });
        let out = Command::new(java).arg("-jar").arg(&jar).output().unwrap();
        assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "hi");
        let d = tauri::async_runtime::block_on(javadoc_generate(root, None)).unwrap();
        assert!(d.ok, "{}", d.output);
        assert!(std::fs::read_to_string(dir.join("doc").join("Hello.html")).unwrap().contains("Says hello."));
        let _ = std::fs::remove_dir_all(dir);
    }
}
