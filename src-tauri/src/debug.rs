//! The debugger: a helper JVM (bench/LogiqDebug.java, built on JDI) that
//! launches the program, and sends events (stopped, output, exited, trace)
//! as JSON lines, which are passed to the page as they come.

use crate::runner::{class_path, java_bin, no_window};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

const HELPER: &str = include_str!("../bench/LogiqDebug.java");
const MARK: &str = "\u{1}LOGIQ ";

struct Session {
    child: Child,
    stdin: ChildStdin,
}

#[derive(Default)]
pub struct Debugger(Mutex<Option<Session>>);

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// Compiles the helper into the app's cache, once per JDK and helper version.
fn helper_dir(app: &AppHandle, javac: &Path) -> Result<PathBuf, String> {
    let base = app.path().app_cache_dir().map_err(err)?.join("debug");
    std::fs::create_dir_all(&base).map_err(err)?;
    let stamp = format!("{}\n{}", javac.to_string_lossy(), HELPER.len());
    let stamp_file = base.join("stamp.txt");
    if base.join("LogiqDebug.class").is_file() && std::fs::read_to_string(&stamp_file).ok().as_deref() == Some(&stamp) {
        return Ok(base);
    }
    let source = base.join("LogiqDebug.java");
    std::fs::write(&source, HELPER).map_err(err)?;
    let out = no_window(Command::new(javac).args(["-encoding", "UTF-8", "-nowarn", "-d"]).arg(&base).arg(&source))
        .output()
        .map_err(|e| format!("javac couldn't be started: {e}"))?;
    if !out.status.success() {
        return Err(format!("The debugger couldn't be prepared:\n{}", String::from_utf8_lossy(&out.stderr)));
    }
    std::fs::write(&stamp_file, stamp).map_err(err)?;
    Ok(base)
}

fn stop(d: &Debugger) {
    if let Ok(mut slot) = d.0.lock() {
        if let Some(mut s) = slot.take() {
            let _ = s.stdin.write_all(b"stop\n");
            let _ = s.stdin.flush();
            std::thread::sleep(std::time::Duration::from_millis(100));
            let _ = s.child.kill();
        }
    }
}

/// Starts the helper and launches `main_class` under it. Events arrive as "debug-event".
#[tauri::command]
pub async fn debug_start(
    app: AppHandle,
    root: String,
    jdk_home: Option<String>,
    main_class: String,
    args: Vec<String>,
    vm_options: String,
    breakpoints: Vec<String>,
    trace: bool,
    project_classes: Vec<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Debugger>();
        stop(&state);
        let dir = helper_dir(&app, &java_bin(&jdk_home, "javac"))?;
        let root = PathBuf::from(root);
        let mut cmd = Command::new(java_bin(&jdk_home, "java"));
        cmd.current_dir(&root)
            .args(["-Dfile.encoding=UTF-8", "-Dstdout.encoding=UTF-8", "-cp"])
            .arg(&dir)
            .arg("LogiqDebug")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = no_window(&mut cmd).spawn().map_err(|e| format!("Java couldn't be started: {e}"))?;
        let stdout = child.stdout.take().ok_or("no output")?;
        let stderr = child.stderr.take().ok_or("no error output")?;
        let mut stdin = child.stdin.take().ok_or("no input")?;
        let out_app = app.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                if let Some(json) = line.strip_prefix(MARK) {
                    let _ = out_app.emit("debug-event", json.to_string());
                }
            }
            let _ = out_app.emit("debug-event", "{\"event\":\"closed\"}".to_string());
        });
        let err_app = app.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                let _ = err_app.emit("debug-event", format!("{{\"event\":\"output\",\"stream\":\"stderr\",\"text\":{}}}", serde_json::to_string(&format!("{line}\n")).unwrap_or_default()));
            }
        });
        let cp = class_path(&root, &root.join("out"));
        let mut fields = vec![
            "launch".to_string(),
            main_class,
            cp,
            if trace { "1" } else { "0" }.to_string(),
            project_classes.join(","),
            breakpoints.join(","),
            vm_options,
        ];
        fields.extend(args);
        stdin.write_all(encode(&fields).as_bytes()).map_err(err)?;
        stdin.flush().map_err(err)?;
        *state.0.lock().map_err(err)? = Some(Session { child, stdin });
        Ok(())
    })
    .await
    .map_err(err)?
}

/// Escapes and joins request fields the way the helpers read them.
pub fn encode(fields: &[String]) -> String {
    let parts: Vec<String> = fields
        .iter()
        .map(|f| f.replace('\\', "\\\\").replace('\n', "\\n").replace('\u{1F}', " "))
        .collect();
    format!("{}\n", parts.join("\u{1F}"))
}

/// Sends one request: resume, over, into, out, pause, stop, break, frame, expand, eval, input.
#[tauri::command]
pub fn debug_send(state: State<Debugger>, fields: Vec<String>) -> Result<(), String> {
    let mut slot = state.0.lock().map_err(err)?;
    let s = slot.as_mut().ok_or("The debugger isn't running.")?;
    s.stdin.write_all(encode(&fields).as_bytes()).map_err(err)?;
    s.stdin.flush().map_err(err)
}

#[tauri::command]
pub fn debug_stop(state: State<Debugger>) {
    stop(&state);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::{channel, Receiver};
    use std::time::Duration;

    fn next(rx: &Receiver<String>, what: &str) -> serde_json::Value {
        loop {
            let line = rx.recv_timeout(Duration::from_secs(20)).unwrap_or_else(|_| panic!("no {what} event"));
            let v: serde_json::Value = serde_json::from_str(&line).unwrap();
            if v["event"] == what {
                return v;
            }
            if v["event"] == "error" {
                panic!("helper error: {line}");
            }
        }
    }

    /// Debugs and traces a real program when a JDK is installed.
    #[test]
    fn helper_debugs_and_traces() {
        let Some(jdk) = crate::runner::detect_jdks().into_iter().next() else { return };
        let bin = |t: &str| Path::new(&jdk.home).join("bin").join(if cfg!(windows) { format!("{t}.exe") } else { t.to_string() });
        let dir = std::env::temp_dir().join(format!("logiq-debug-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("out")).unwrap();
        std::fs::write(dir.join("LogiqDebug.java"), HELPER).unwrap();
        std::fs::write(
            dir.join("Main.java"),
            "public class Main {\n    static int twice(int x) {\n        int y = x * 2;\n        return y;\n    }\n    public static void main(String[] args) {\n        Counter c = new Counter();\n        int total = 0;\n        for (int i = 0; i < 3; i++) {\n            total += twice(i);\n            c.add(i);\n        }\n        System.out.println(\"total \" + total + \" Grüße\");\n    }\n}\nclass Counter {\n    private int count;\n    private java.util.List<String> log = new java.util.ArrayList<>();\n    void add(int n) { count += n; log.add(\"n\" + n); }\n}\n",
        )
        .unwrap();
        assert!(Command::new(bin("javac")).args(["-g", "-encoding", "UTF-8", "-d"]).arg(dir.join("out")).arg(dir.join("Main.java")).status().unwrap().success());
        assert!(Command::new(bin("javac")).arg("-d").arg(&dir).arg(dir.join("LogiqDebug.java")).status().unwrap().success());

        let start = |trace: bool, bps: &str| {
            let mut child = Command::new(bin("java"))
                .arg("-cp")
                .arg(&dir)
                .arg("LogiqDebug")
                .current_dir(&dir)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .spawn()
                .unwrap();
            let stdout = child.stdout.take().unwrap();
            let (tx, rx) = channel();
            std::thread::spawn(move || {
                for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                    if let Some(j) = line.strip_prefix(MARK) {
                        let _ = tx.send(j.to_string());
                    }
                }
            });
            let mut stdin = child.stdin.take().unwrap();
            let fields: Vec<String> = ["launch", "Main", &dir.join("out").to_string_lossy(), if trace { "1" } else { "0" }, "Main,Counter", bps, ""].iter().map(|s| s.to_string()).collect();
            stdin.write_all(encode(&fields).as_bytes()).unwrap();
            stdin.flush().unwrap();
            (child, stdin, rx)
        };
        let send = |stdin: &mut ChildStdin, f: &[&str]| {
            let v: Vec<String> = f.iter().map(|s| s.to_string()).collect();
            stdin.write_all(encode(&v).as_bytes()).unwrap();
            stdin.flush().unwrap();
        };

        // Breakpoint, variables, stepping, watches, expanding, removing a breakpoint.
        let (mut child, mut stdin, rx) = start(false, "Main:10");
        next(&rx, "started");
        let s = next(&rx, "stopped");
        assert_eq!(s["reason"], "breakpoint");
        assert_eq!(s["frames"][0]["line"], 10);
        let vars: Vec<String> = s["variables"].as_array().unwrap().iter().map(|v| format!("{}={}", v["name"].as_str().unwrap(), v["value"].as_str().unwrap())).collect();
        assert!(vars.contains(&"total=0".to_string()) && vars.contains(&"i=0".to_string()), "{vars:?}");
        send(&mut stdin, &["into"]);
        let s = next(&rx, "stopped");
        assert_eq!((s["frames"][0]["method"].as_str().unwrap(), s["frames"][0]["line"].as_i64().unwrap()), ("twice", 3));
        send(&mut stdin, &["out"]);
        let s = next(&rx, "stopped");
        assert_eq!(s["frames"][0]["method"], "main");
        send(&mut stdin, &["over"]);
        let s = next(&rx, "stopped");
        assert_eq!(s["frames"][0]["line"], 11);
        send(&mut stdin, &["eval", "0", "c.log"]);
        let w = next(&rx, "watch");
        assert!(w["value"]["value"].as_str().unwrap().starts_with("ArrayList (0)"), "{w}");
        send(&mut stdin, &["over"]);
        next(&rx, "stopped");
        // Object ids hold while the program stays paused at one place.
        send(&mut stdin, &["eval", "0", "c.log"]);
        let w = next(&rx, "watch");
        let id = w["value"]["id"].as_i64().unwrap();
        send(&mut stdin, &["expand", &id.to_string()]);
        let c = next(&rx, "children");
        assert_eq!(c["children"][0]["value"], "\"n0\"", "{c}");
        send(&mut stdin, &["break", "Main", "10", "0"]);
        send(&mut stdin, &["resume"]);
        let mut text = String::new();
        loop {
            let line = rx.recv_timeout(Duration::from_secs(20)).unwrap();
            let v: serde_json::Value = serde_json::from_str(&line).unwrap();
            if v["event"] == "output" {
                text.push_str(v["text"].as_str().unwrap());
            }
            if v["event"] == "exited" {
                assert_eq!(v["code"], 0);
                break;
            }
            assert_ne!(v["event"], "stopped", "stopped again: {line}");
        }
        assert_eq!(text, "total 6 Grüße\n");
        let _ = child.wait();

        // Tracing: the calls between the project's classes.
        let (mut child, _stdin, rx) = start(true, "");
        let t = next(&rx, "trace");
        let calls: Vec<String> = t["calls"].as_array().unwrap().iter().filter(|c| c["kind"] == "call").map(|c| format!("{}->{}:{}", c["from"].as_str().unwrap(), c["to"].as_str().unwrap(), c["method"].as_str().unwrap())).collect();
        assert_eq!(calls[0], "actor->Main:main");
        assert!(calls.contains(&"Main->counter1:Counter:new".to_string()), "{calls:?}");
        assert!(calls.contains(&"Main->Main:twice".to_string()), "{calls:?}");
        assert_eq!(calls.iter().filter(|c| c.ends_with(":add")).count(), 3);
        let returns: Vec<&serde_json::Value> = t["calls"].as_array().unwrap().iter().filter(|c| c["kind"] == "return" && c["method"] == "twice").collect();
        assert_eq!(returns[2]["value"], "4");
        next(&rx, "exited");
        let _ = child.wait();
        let _ = std::fs::remove_dir_all(dir);
    }
}
