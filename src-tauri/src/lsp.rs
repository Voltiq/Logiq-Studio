//! Language servers spoken to over standard input and output, with the
//! Language Server Protocol's `Content-Length` framing. Messages pass
//! through unchanged; the page is the LSP client. The Java server (Eclipse
//! JDT LS) is downloaded on request and started from the app's data folder.

use crate::runner::{java_bin, no_window};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

struct Server {
    child: Child,
    stdin: ChildStdin,
}

#[derive(Default)]
pub struct Servers(Mutex<HashMap<String, Server>>);

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

#[derive(Serialize, Clone)]
struct Message {
    id: String,
    message: String,
}

/// Reads LSP-framed messages from a stream; returns None at the end.
pub fn read_message(r: &mut impl BufRead) -> Option<String> {
    let mut length: Option<usize> = None;
    loop {
        let mut line = String::new();
        if r.read_line(&mut line).ok()? == 0 {
            return None;
        }
        let line = line.trim_end();
        if line.is_empty() {
            break;
        }
        if let Some(v) = line.strip_prefix("Content-Length:") {
            length = v.trim().parse().ok();
        }
    }
    let mut body = vec![0u8; length?];
    r.read_exact(&mut body).ok()?;
    Some(String::from_utf8_lossy(&body).into_owned())
}

pub fn frame(message: &str) -> Vec<u8> {
    let mut out = format!("Content-Length: {}\r\n\r\n", message.len()).into_bytes();
    out.extend_from_slice(message.as_bytes());
    out
}

fn start(app: AppHandle, id: String, mut cmd: Command) -> Result<(), String> {
    stop_one(&app.state::<Servers>(), &id);
    cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = no_window(&mut cmd).spawn().map_err(|e| format!("The language server couldn't be started: {e}"))?;
    let stdout = child.stdout.take().ok_or("no output")?;
    let mut stderr = child.stderr.take().ok_or("no error output")?;
    let stdin = child.stdin.take().ok_or("no input")?;
    let (out_app, out_id) = (app.clone(), id.clone());
    std::thread::spawn(move || {
        let mut r = BufReader::new(stdout);
        while let Some(message) = read_message(&mut r) {
            let _ = out_app.emit("lsp-message", Message { id: out_id.clone(), message });
        }
        let _ = out_app.emit("lsp-exit", out_id);
    });
    // The server's own log; drained so it never blocks.
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        while let Ok(n) = stderr.read(&mut buf) {
            if n == 0 {
                break;
            }
        }
    });
    app.state::<Servers>().0.lock().map_err(err)?.insert(id, Server { child, stdin });
    Ok(())
}

fn stop_one(servers: &Servers, id: &str) {
    if let Ok(mut map) = servers.0.lock() {
        if let Some(mut s) = map.remove(id) {
            let _ = s.child.kill();
        }
    }
}

#[tauri::command]
pub fn lsp_send(state: State<Servers>, id: String, message: String) -> Result<(), String> {
    let mut map = state.0.lock().map_err(err)?;
    let s = map.get_mut(&id).ok_or("The language server isn't running.")?;
    s.stdin.write_all(&frame(&message)).map_err(err)?;
    s.stdin.flush().map_err(err)
}

#[tauri::command]
pub fn lsp_stop(state: State<Servers>, id: String) {
    stop_one(&state, &id);
}

/// Starts a language server that speaks LSP over standard input and output (clangd, pylsp, …).
#[tauri::command]
pub fn lsp_start_program(app: AppHandle, id: String, program: String, args: Vec<String>, cwd: Option<String>) -> Result<(), String> {
    let mut cmd = Command::new(&program);
    cmd.args(&args);
    if let Some(dir) = cwd.as_deref().filter(|d| Path::new(d).is_dir()) {
        cmd.current_dir(dir);
    }
    start(app, id, cmd)
}

// ----- Eclipse JDT Language Server ------------------------------------------------------------

const JDTLS_URL: &str = "https://download.eclipse.org/jdtls/snapshots/jdt-language-server-latest.tar.gz";

fn jdtls_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(err)?.join("jdtls"))
}

fn launcher(dir: &Path) -> Option<PathBuf> {
    std::fs::read_dir(dir.join("plugins"))
        .ok()?
        .flatten()
        .map(|e| e.path())
        .find(|p| {
            let n = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            n.starts_with("org.eclipse.equinox.launcher_") && n.ends_with(".jar")
        })
}

/// Whether the Java language server is installed, and where.
#[tauri::command]
pub fn jdtls_status(app: AppHandle) -> Option<String> {
    let dir = jdtls_dir(&app).ok()?;
    launcher(&dir).map(|_| dir.to_string_lossy().to_string())
}

/// Downloads the latest JDT LS build and unpacks it into `dir`.
pub fn install_into(dir: &Path) -> Result<(), String> {
    let resp = ureq::get(JDTLS_URL).call().map_err(|e| format!("The download failed: {e}"))?;
    let mut bytes = Vec::new();
    resp.into_reader().take(300 * 1024 * 1024).read_to_end(&mut bytes).map_err(err)?;
    let tmp = dir.with_extension("partial");
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).map_err(err)?;
    tar::Archive::new(flate2::read::GzDecoder::new(&bytes[..])).unpack(&tmp).map_err(|e| format!("The download couldn't be unpacked: {e}"))?;
    if launcher(&tmp).is_none() {
        return Err("The download isn't a Java language server.".into());
    }
    let _ = std::fs::remove_dir_all(dir);
    std::fs::rename(&tmp, dir).map_err(err)
}

/// Downloads the latest JDT LS build and unpacks it into the app's data folder.
#[tauri::command]
pub async fn jdtls_install(app: AppHandle) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = jdtls_dir(&app)?;
        install_into(&dir)?;
        Ok(dir.to_string_lossy().to_string())
    })
    .await
    .map_err(err)?
}

/// The command line that starts JDT LS from `dir` with its index data in `data`.
pub fn jdtls_command(dir: &Path, data: &Path, jdk_home: &Option<String>) -> Result<Command, String> {
    let jar = launcher(dir).ok_or("The Java language server isn't installed.")?;
    let config = dir.join(if cfg!(windows) {
        "config_win"
    } else if cfg!(target_os = "macos") {
        "config_mac"
    } else {
        "config_linux"
    });
    let mut cmd = Command::new(java_bin(jdk_home, "java"));
    cmd.args([
        "-Declipse.application=org.eclipse.jdt.ls.core.id1",
        "-Dosgi.bundles.defaultStartLevel=4",
        "-Declipse.product=org.eclipse.jdt.ls.core.product",
        "-Dlog.level=ERROR",
        "-Dfile.encoding=UTF-8",
        "-Xms256m",
        "-Xmx1G",
        "--add-modules=ALL-SYSTEM",
        "--add-opens",
        "java.base/java.util=ALL-UNNAMED",
        "--add-opens",
        "java.base/java.lang=ALL-UNNAMED",
        "-jar",
    ])
    .arg(jar)
    .arg("-configuration")
    .arg(config)
    .arg("-data")
    .arg(data);
    Ok(cmd)
}

/// Starts JDT LS for a project. Its own data (indexes) lives in the app's cache, one folder per project.
#[tauri::command]
pub fn jdtls_start(app: AppHandle, root: String, jdk_home: Option<String>) -> Result<(), String> {
    let dir = jdtls_dir(&app)?;
    let hash = root.to_lowercase().bytes().fold(1469598103934665603u64, |h, b| (h ^ b as u64).wrapping_mul(1099511628211));
    let data = app.path().app_cache_dir().map_err(err)?.join("jdtls-workspaces").join(format!("{hash:016x}"));
    std::fs::create_dir_all(&data).map_err(err)?;
    let mut cmd = jdtls_command(&dir, &data, &jdk_home)?;
    cmd.current_dir(&root);
    start(app, "java".into(), cmd)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_round_trip() {
        let mut bytes = frame(r#"{"jsonrpc":"2.0","id":1,"result":"Grüße"}"#);
        bytes.extend(frame("{}"));
        let mut r = BufReader::new(&bytes[..]);
        assert_eq!(read_message(&mut r).unwrap(), r#"{"jsonrpc":"2.0","id":1,"result":"Grüße"}"#);
        assert_eq!(read_message(&mut r).unwrap(), "{}");
        assert!(read_message(&mut r).is_none());
        // Extra headers are allowed.
        let mut r = BufReader::new(&b"Content-Type: x\r\nContent-Length: 2\r\n\r\n[]"[..]);
        assert_eq!(read_message(&mut r).unwrap(), "[]");
    }

    /// Installs JDT LS into the app's data folder (when it isn't there yet), starts it on a
    /// small project and checks errors, completion and a quick fix. Needs the network the
    /// first time and a JDK: `cargo test jdtls_end_to_end -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn jdtls_end_to_end() {
        use serde_json::{json, Value};
        use std::sync::mpsc;
        use std::time::{Duration, Instant};

        let base = std::env::var("APPDATA").map(PathBuf::from).unwrap_or_else(|_| std::env::temp_dir());
        let dir = base.join("com.voltiq.logiq-studio").join("jdtls");
        if launcher(&dir).is_none() {
            let t = Instant::now();
            install_into(&dir).unwrap();
            eprintln!("installed in {:?}", t.elapsed());
        }
        let project = std::env::temp_dir().join("logiq-jdtls-test");
        let _ = std::fs::remove_dir_all(&project);
        std::fs::create_dir_all(project.join("src")).unwrap();
        let file = project.join("src").join("Hello.java");
        let text = "public class Hello {
    public static void main(String[] args) {
        List<String> names = null;
        String s = \"x\";
        int n = \"oops\";
        s.
    }
}
";
        std::fs::write(&file, text).unwrap();
        let data = std::env::temp_dir().join("logiq-jdtls-test-data");
        let _ = std::fs::remove_dir_all(&data);

        let mut cmd = jdtls_command(&dir, &data, &None).unwrap();
        cmd.current_dir(&project).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
        let mut child = cmd.spawn().unwrap();
        let mut stdin = child.stdin.take().unwrap();
        let stdout = child.stdout.take().unwrap();
        let (tx, rx) = mpsc::channel::<Value>();
        std::thread::spawn(move || {
            let mut r = BufReader::new(stdout);
            while let Some(m) = read_message(&mut r) {
                if tx.send(serde_json::from_str(&m).unwrap()).is_err() {
                    break;
                }
            }
        });
        let mut send = |v: Value| {
            stdin.write_all(&frame(&v.to_string())).unwrap();
            stdin.flush().unwrap();
        };
        // Waits for a message, answering the server's own requests on the way.
        let wait = |send: &mut dyn FnMut(Value), pred: &dyn Fn(&Value) -> bool, secs: u64| -> Value {
            let end = Instant::now() + Duration::from_secs(secs);
            loop {
                let m = rx.recv_timeout(end.saturating_duration_since(Instant::now())).expect("timed out");
                if m.get("method").is_some() && m.get("id").is_some() {
                    let result = if m["method"] == "workspace/configuration" { json!(m["params"]["items"].as_array().map(|a| a.iter().map(|_| Value::Null).collect::<Vec<_>>()).unwrap_or_default()) } else { Value::Null };
                    send(json!({"jsonrpc": "2.0", "id": m["id"], "result": result}));
                    continue;
                }
                if pred(&m) {
                    return m;
                }
            }
        };
        let uri = format!("file:///{}", file.to_string_lossy().replace('\\', "/"));
        let root = format!("file:///{}", project.to_string_lossy().replace('\\', "/"));
        let t = Instant::now();
        send(json!({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"processId": null, "rootUri": root, "capabilities": {"textDocument": {"publishDiagnostics": {}, "completion": {"completionItem": {"snippetSupport": true}}, "codeAction": {"codeActionLiteralSupport": {"codeActionKind": {"valueSet": ["quickfix", "refactor", "source", "source.organizeImports"]}}, "resolveSupport": {"properties": ["edit"]}}}}, "workspaceFolders": [{"uri": root, "name": "test"}], "initializationOptions": {"settings": {"java": {"completion": {"filteredTypes": ["java.awt.List", "com.sun.*", "sun.*", "jdk.*"]}}}}}}));
        wait(&mut send, &|m| m["id"] == 1, 120);
        send(json!({"jsonrpc": "2.0", "method": "initialized", "params": {}}));
        send(json!({"jsonrpc": "2.0", "method": "textDocument/didOpen", "params": {"textDocument": {"uri": uri, "languageId": "java", "version": 1, "text": text}}}));
        let diags = wait(&mut send, &|m| m["method"] == "textDocument/publishDiagnostics" && m["params"]["diagnostics"].as_array().is_some_and(|d| d.len() >= 2), 180);
        eprintln!("diagnostics after {:?}:", t.elapsed());
        let list = diags["params"]["diagnostics"].as_array().unwrap().clone();
        for d in &list {
            eprintln!("  {}:{} {}", d["range"]["start"]["line"], d["range"]["start"]["character"], d["message"]);
        }
        assert!(list.iter().any(|d| d["message"].as_str().unwrap().contains("List")));
        assert!(list.iter().any(|d| d["message"].as_str().unwrap().contains("Type mismatch")));

        send(json!({"jsonrpc": "2.0", "id": 2, "method": "textDocument/completion", "params": {"textDocument": {"uri": uri}, "position": {"line": 5, "character": 10}}}));
        let c = wait(&mut send, &|m| m["id"] == 2, 60);
        let items = c["result"]["items"].as_array().cloned().or_else(|| c["result"].as_array().cloned()).unwrap_or_default();
        let labels: Vec<String> = items.iter().map(|i| i["label"].as_str().unwrap_or("").to_string()).collect();
        eprintln!("{} completions, e.g. {:?}", labels.len(), &labels[..labels.len().min(5)]);
        assert!(labels.iter().any(|l| l.starts_with("length")));

        let list_diag = list.iter().find(|d| d["message"].as_str().unwrap().contains("List")).unwrap().clone();
        send(json!({"jsonrpc": "2.0", "id": 3, "method": "textDocument/codeAction", "params": {"textDocument": {"uri": uri}, "range": list_diag["range"], "context": {"diagnostics": [list_diag], "only": ["quickfix"]}}}));
        let a = wait(&mut send, &|m| m["id"] == 3, 60);
        let titles: Vec<String> = a["result"].as_array().unwrap().iter().map(|x| x["title"].as_str().unwrap_or("").to_string()).collect();
        eprintln!("quick fixes: {titles:?}");
        assert!(titles.iter().any(|t| t == "Import 'List' (java.util)"));
        assert!(!titles.iter().any(|t| t.contains("com.sun") || t.contains("(java.awt)")), "internal packages are filtered");

        // Refactorings for a selected expression: `"x"` on line 3 (`        String s = "x";`).
        send(json!({"jsonrpc": "2.0", "id": 5, "method": "textDocument/codeAction", "params": {"textDocument": {"uri": uri}, "range": {"start": {"line": 3, "character": 19}, "end": {"line": 3, "character": 22}}, "context": {"diagnostics": [], "only": ["refactor"]}}}));
        let a = wait(&mut send, &|m| m["id"] == 5, 60);
        let actions = a["result"].as_array().cloned().unwrap_or_default();
        let titles: Vec<String> = actions.iter().map(|x| x["title"].as_str().unwrap_or("").to_string()).collect();
        eprintln!("refactorings: {titles:?}");
        let extract = actions.iter().find(|x| x["title"].as_str().unwrap_or("").starts_with("Extract to local variable")).expect("no extract to variable");
        // Without the advanced client support, JDT LS hands over the edit itself (or a command that carries it).
        let edit = extract.get("edit").cloned().or_else(|| extract["command"]["arguments"].as_array().and_then(|a| a.iter().find(|x| x.get("changes").is_some() || x.get("documentChanges").is_some()).cloned()));
        let edit = match edit {
            Some(e) => e,
            None => {
                send(json!({"jsonrpc": "2.0", "id": 6, "method": "codeAction/resolve", "params": extract}));
                wait(&mut send, &|m| m["id"] == 6, 60)["result"]["edit"].clone()
            }
        };
        let text = edit.to_string();
        assert!(text.contains("String string = \\\"x\\\"") || text.contains("= \\\"x\\\""), "{text}");

        send(json!({"jsonrpc": "2.0", "id": 4, "method": "shutdown"}));
        let _ = wait(&mut send, &|m| m["id"] == 4, 30);
        send(json!({"jsonrpc": "2.0", "method": "exit"}));
        let _ = child.wait();
    }

    /// Starts clangd (when LLVM is installed) the way the app does and checks that a C
    /// file gets its errors and completion: `cargo test clangd_end_to_end -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn clangd_end_to_end() {
        use serde_json::{json, Value};
        use std::sync::mpsc;
        use std::time::{Duration, Instant};

        let Some(clangd) = tauri::async_runtime::block_on(crate::toolchain::tools_find("clangd".into(), None)).into_iter().next() else {
            eprintln!("clangd isn't installed; skipped");
            return;
        };
        let project = std::env::temp_dir().join("logiq-clangd-test");
        let _ = std::fs::remove_dir_all(&project);
        std::fs::create_dir_all(&project).unwrap();
        let file = project.join("main.c");
        let text = "#include <stdio.h>\n\nstruct Point { int x; int y; };\n\nint main(void) {\n    struct Point p = { 1, 2 };\n    printf(\"%d\\n\", p.);\n    return undefined_name;\n}\n";
        std::fs::write(&file, text).unwrap();

        let mut cmd = Command::new(&clangd.path);
        cmd.args(["--header-insertion=never", "--background-index=false", "--log=error"]).current_dir(&project).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
        let mut child = no_window(&mut cmd).spawn().unwrap();
        let mut stdin = child.stdin.take().unwrap();
        let stdout = child.stdout.take().unwrap();
        let (tx, rx) = mpsc::channel::<Value>();
        std::thread::spawn(move || {
            let mut r = BufReader::new(stdout);
            while let Some(m) = read_message(&mut r) {
                if tx.send(serde_json::from_str(&m).unwrap()).is_err() {
                    break;
                }
            }
        });
        let mut send = |v: Value| {
            stdin.write_all(&frame(&v.to_string())).unwrap();
            stdin.flush().unwrap();
        };
        let wait = |send: &mut dyn FnMut(Value), pred: &dyn Fn(&Value) -> bool, secs: u64| -> Value {
            let end = Instant::now() + Duration::from_secs(secs);
            loop {
                let m = rx.recv_timeout(end.saturating_duration_since(Instant::now())).expect("timed out");
                if m.get("method").is_some() && m.get("id").is_some() {
                    send(json!({"jsonrpc": "2.0", "id": m["id"], "result": Value::Null}));
                    continue;
                }
                if pred(&m) {
                    return m;
                }
            }
        };
        let uri = format!("file:///{}", file.to_string_lossy().replace('\\', "/"));
        let root = format!("file:///{}", project.to_string_lossy().replace('\\', "/"));
        let t = Instant::now();
        send(json!({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"processId": null, "rootUri": root, "capabilities": {"textDocument": {"publishDiagnostics": {}, "completion": {"completionItem": {"snippetSupport": true}}}}, "initializationOptions": {"fallbackFlags": ["-Wall", "-Wextra", "-D_CRT_SECURE_NO_WARNINGS"]}}}));
        wait(&mut send, &|m| m["id"] == 1, 30);
        send(json!({"jsonrpc": "2.0", "method": "initialized", "params": {}}));
        send(json!({"jsonrpc": "2.0", "method": "textDocument/didOpen", "params": {"textDocument": {"uri": uri, "languageId": "c", "version": 1, "text": text}}}));
        let diags = wait(&mut send, &|m| m["method"] == "textDocument/publishDiagnostics" && m["params"]["diagnostics"].as_array().is_some_and(|d| !d.is_empty()), 60);
        let list = diags["params"]["diagnostics"].as_array().unwrap().clone();
        eprintln!("diagnostics after {:?}:", t.elapsed());
        for d in &list {
            eprintln!("  {}:{} {}", d["range"]["start"]["line"], d["range"]["start"]["character"], d["message"]);
        }
        assert!(list.iter().any(|d| d["message"].as_str().unwrap().contains("undefined_name")), "an undeclared name is an error");

        // Completion right after `p.` on line 6 (the printf call).
        send(json!({"jsonrpc": "2.0", "id": 2, "method": "textDocument/completion", "params": {"textDocument": {"uri": uri}, "position": {"line": 6, "character": 21}}}));
        let c = wait(&mut send, &|m| m["id"] == 2, 30);
        let items = c["result"]["items"].as_array().cloned().or_else(|| c["result"].as_array().cloned()).unwrap_or_default();
        let labels: Vec<String> = items.iter().map(|i| i["label"].as_str().unwrap_or("").trim().to_string()).collect();
        eprintln!("completions: {labels:?}");
        assert!(labels.iter().any(|l| l == "x") && labels.iter().any(|l| l == "y"));
        send(json!({"jsonrpc": "2.0", "id": 3, "method": "shutdown"}));
        let _ = wait(&mut send, &|m| m["id"] == 3, 10);
        send(json!({"jsonrpc": "2.0", "method": "exit"}));
        let _ = child.wait();
        let _ = std::fs::remove_dir_all(&project);
    }
}
