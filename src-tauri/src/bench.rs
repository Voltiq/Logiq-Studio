//! The object bench: a JVM with the project's compiled classes and a small
//! helper (bench/LogiqBench.java) that creates objects and calls methods by
//! reflection, one request per line, one JSON answer per line.

use crate::runner::{class_path, java_bin, no_window};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

const HELPER: &str = include_str!("../bench/LogiqBench.java");
const MARK: &str = "\u{1}LOGIQ ";

struct Proc {
    child: Child,
    stdin: ChildStdin,
}

#[derive(Default)]
pub struct Bench {
    proc: Mutex<Option<Proc>>,
    replies: Arc<Mutex<Option<Receiver<String>>>>,
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// Compiles the helper into the app's cache, once per JDK and helper version.
fn helper_dir(app: &AppHandle, javac: &Path) -> Result<PathBuf, String> {
    let base = app.path().app_cache_dir().map_err(err)?.join("bench");
    std::fs::create_dir_all(&base).map_err(err)?;
    let stamp = format!("{}\n{}", javac.to_string_lossy(), HELPER.len());
    let stamp_file = base.join("stamp.txt");
    if base.join("LogiqBench.class").is_file() && std::fs::read_to_string(&stamp_file).ok().as_deref() == Some(&stamp) {
        return Ok(base);
    }
    let source = base.join("LogiqBench.java");
    std::fs::write(&source, HELPER).map_err(err)?;
    let out = no_window(Command::new(javac).args(["-encoding", "UTF-8", "-nowarn", "-d"]).arg(&base).arg(&source))
        .output()
        .map_err(|e| format!("javac couldn't be started: {e}"))?;
    if !out.status.success() {
        return Err(format!("The object bench couldn't be prepared:\n{}", String::from_utf8_lossy(&out.stderr)));
    }
    std::fs::write(&stamp_file, stamp).map_err(err)?;
    Ok(base)
}

fn stop(bench: &Bench) {
    if let Ok(mut slot) = bench.proc.lock() {
        if let Some(mut p) = slot.take() {
            let _ = p.child.kill();
        }
    }
}

/// Starts a fresh bench for the classes in `<root>/out`; returns the first answer (an empty bench).
#[tauri::command]
pub async fn bench_start(app: AppHandle, root: String, jdk_home: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let bench = app.state::<Bench>();
        stop(&bench);
        let dir = helper_dir(&app, &java_bin(&jdk_home, "javac"))?;
        let root = PathBuf::from(root);
        let cp = format!("{}{}{}", class_path(&root, &root.join("out")), if cfg!(windows) { ";" } else { ":" }, dir.to_string_lossy());
        let mut cmd = Command::new(java_bin(&jdk_home, "java"));
        cmd.current_dir(&root)
            .args(["-Dfile.encoding=UTF-8", "-Dstdout.encoding=UTF-8", "-Dstderr.encoding=UTF-8", "-cp"])
            .arg(cp)
            .arg("LogiqBench")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = no_window(&mut cmd).spawn().map_err(|e| format!("Java couldn't be started: {e}"))?;
        let stdout = child.stdout.take().ok_or("no output")?;
        let mut stderr = child.stderr.take().ok_or("no error output")?;
        let stdin = child.stdin.take().ok_or("no input")?;
        let (tx, rx) = channel::<String>();
        // Answers go to the waiting request; anything else (threads printing later) to the output panel.
        let out_app = app.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                if let Some(json) = line.strip_prefix(MARK) {
                    if tx.send(json.to_string()).is_err() {
                        break;
                    }
                } else {
                    let _ = out_app.emit("bench-output", format!("{line}\n"));
                }
            }
        });
        let err_app = app.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            while let Ok(n) = stderr.read(&mut buf) {
                if n == 0 {
                    break;
                }
                let _ = err_app.emit("bench-output", String::from_utf8_lossy(&buf[..n]).to_string());
            }
        });
        *bench.replies.lock().map_err(err)? = Some(rx);
        *bench.proc.lock().map_err(err)? = Some(Proc { child, stdin });
        receive(&bench, Duration::from_secs(20))
    })
    .await
    .map_err(err)?
}

fn receive(bench: &Bench, timeout: Duration) -> Result<String, String> {
    let guard = bench.replies.lock().map_err(err)?;
    let rx = guard.as_ref().ok_or("The object bench isn't running.")?;
    match rx.recv_timeout(timeout) {
        Ok(json) => Ok(json),
        Err(RecvTimeoutError::Timeout) => Err("timeout".into()),
        Err(RecvTimeoutError::Disconnected) => Err("stopped".into()),
    }
}

/// Sends one request (fields already escaped and joined) and waits for its answer.
#[tauri::command]
pub async fn bench_send(app: AppHandle, request: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let bench = app.state::<Bench>();
        {
            let mut slot = bench.proc.lock().map_err(err)?;
            let p = slot.as_mut().ok_or("The object bench isn't running.")?;
            p.stdin.write_all(request.replace('\n', "\\n").as_bytes()).map_err(err)?;
            p.stdin.write_all(b"\n").map_err(err)?;
            p.stdin.flush().map_err(err)?;
        }
        // A method that never returns keeps the bench busy; the page offers a reset.
        receive(&bench, Duration::from_secs(15))
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub fn bench_stop(state: State<Bench>) {
    stop(&state);
    if let Ok(mut r) = state.replies.lock() {
        *r = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Runs the helper against a real class when a JDK is installed.
    #[test]
    fn helper_creates_objects_and_calls_methods() {
        let Some(jdk) = crate::runner::detect_jdks().into_iter().next() else { return };
        let dir = std::env::temp_dir().join(format!("logiq-bench-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("LogiqBench.java"), HELPER).unwrap();
        std::fs::write(
            dir.join("Counter.java"),
            "public class Counter { private int count; private String label; public Counter(String label) { this.label = label; } public int add(int n) { System.out.println(\"adding \" + n); count += n; return count; } public Counter copy() { return new Counter(label); } public void fail() { throw new IllegalStateException(\"no\"); } }",
        )
        .unwrap();
        let javac = Path::new(&jdk.home).join("bin").join(if cfg!(windows) { "javac.exe" } else { "javac" });
        let ok = Command::new(&javac).arg("-d").arg(&dir).arg(dir.join("LogiqBench.java")).arg(dir.join("Counter.java")).status().unwrap();
        assert!(ok.success());
        let java = Path::new(&jdk.home).join("bin").join(if cfg!(windows) { "java.exe" } else { "java" });
        let mut child = Command::new(java)
            .arg("-cp")
            .arg(&dir)
            .arg("LogiqBench")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let mut stdin = child.stdin.take().unwrap();
        let reqs = "new\u{1F}c1\u{1F}Counter\u{1F}String\u{1F}\"Ä\"\ncall\u{1F}c1\u{1F}Counter\u{1F}add\u{1F}int\u{1F}5\ncall\u{1F}c1\u{1F}Counter\u{1F}copy\u{1F}\nkeep\u{1F}c2\ncall\u{1F}c1\u{1F}Counter\u{1F}fail\u{1F}\n";
        stdin.write_all(reqs.as_bytes()).unwrap();
        drop(stdin);
        let mut out = String::new();
        child.stdout.take().unwrap().read_to_string(&mut out).unwrap();
        let answers: Vec<&str> = out.lines().filter_map(|l| l.strip_prefix(MARK)).collect();
        assert_eq!(answers.len(), 6, "{out}");
        assert!(answers[1].contains("\"name\":\"label\",\"type\":\"String\",\"value\":\"\\\"Ä\\\"\""), "{}", answers[1]);
        assert!(answers[2].contains("\"value\":{\"text\":\"5\",\"type\":\"int\"}"), "{}", answers[2]);
        assert!(answers[2].contains("\"out\":\"adding 5\\n\""), "{}", answers[2]);
        assert!(answers[3].contains("\"keepable\":true"), "{}", answers[3]);
        assert!(answers[4].contains("\"name\":\"c2\""), "{}", answers[4]);
        assert!(answers[5].contains("\"ok\":false") && answers[5].contains("IllegalStateException: no"), "{}", answers[5]);
        let _ = std::fs::remove_dir_all(dir);
    }
}
