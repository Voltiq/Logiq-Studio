//! Terminals: a shell in a pseudo console (ConPTY on Windows) per tab. The
//! page draws it with xterm.js; this side passes keystrokes in and output out,
//! and resizes the console with the panel.

use crate::runner::java_bin;
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

struct Term {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

#[derive(Default, Clone)]
pub struct Terminals(Arc<Mutex<HashMap<u32, Term>>>);

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

#[derive(Serialize, Clone)]
pub struct Shell {
    id: String,
    name: String,
    path: String,
    args: Vec<String>,
}

#[derive(Serialize, Clone)]
struct Data {
    id: u32,
    data: String,
}

#[derive(Serialize, Clone)]
struct Exit {
    id: u32,
    code: Option<u32>,
}

fn on_path(name: &str) -> Option<PathBuf> {
    std::env::var_os("PATH").and_then(|p| std::env::split_paths(&p).map(|d| d.join(name)).find(|f| f.is_file()))
}

/// The shells on this computer, the preferred one first.
#[tauri::command]
pub fn term_shells() -> Vec<Shell> {
    let mut out = Vec::new();
    let mut add = |id: &str, name: &str, path: PathBuf, args: &[&str]| {
        if path.is_file() && !out.iter().any(|s: &Shell| s.id == id) {
            out.push(Shell { id: id.into(), name: name.into(), path: path.to_string_lossy().into(), args: args.iter().map(|a| a.to_string()).collect() });
        }
    };
    if cfg!(windows) {
        let pf = std::env::var_os("ProgramFiles").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\Program Files"));
        if let Some(p) = on_path("pwsh.exe") {
            add("pwsh", "PowerShell", p, &["-NoLogo"]);
        }
        add("pwsh", "PowerShell", pf.join(r"PowerShell\7\pwsh.exe"), &["-NoLogo"]);
        let root = std::env::var_os("SystemRoot").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
        add("powershell", "Windows PowerShell", root.join(r"System32\WindowsPowerShell\v1.0\powershell.exe"), &["-NoLogo"]);
        add("cmd", "Command Prompt", root.join(r"System32\cmd.exe"), &[]);
        add("bash", "Git Bash", pf.join(r"Git\bin\bash.exe"), &["--login", "-i"]);
    } else {
        if let Some(sh) = std::env::var_os("SHELL") {
            add("default", "Shell", PathBuf::from(sh), &["-l"]);
        }
        add("bash", "Bash", PathBuf::from("/bin/bash"), &["-l"]);
        add("zsh", "Zsh", PathBuf::from("/bin/zsh"), &["-l"]);
    }
    out
}

/// Turns bytes into text, keeping a character that is split between two reads for the next one.
pub fn decode(pending: &mut Vec<u8>, bytes: &[u8]) -> String {
    pending.extend_from_slice(bytes);
    match std::str::from_utf8(pending) {
        Ok(s) => {
            let s = s.to_string();
            pending.clear();
            s
        }
        Err(e) if e.error_len().is_none() => {
            let valid = e.valid_up_to();
            let s = String::from_utf8_lossy(&pending[..valid]).into_owned();
            pending.drain(..valid);
            s
        }
        Err(_) => {
            let s = String::from_utf8_lossy(pending).into_owned();
            pending.clear();
            s
        }
    }
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub fn term_open(app: AppHandle, state: State<Terminals>, id: u32, shell: String, args: Vec<String>, cwd: String, cols: u16, rows: u16, jdk_home: Option<String>, env: Option<std::collections::HashMap<String, String>>, path_prepend: Option<Vec<String>>) -> Result<(), String> {
    let pty = native_pty_system().openpty(PtySize { rows: rows.max(2), cols: cols.max(10), pixel_width: 0, pixel_height: 0 }).map_err(err)?;
    let mut cmd = CommandBuilder::new(&shell);
    cmd.args(&args);
    if Path::new(&cwd).is_dir() {
        cmd.cwd(&cwd);
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERM_PROGRAM", "LogiqStudio");
    // The JDK the IDE uses comes first, so `java` and `javac` in the terminal are the same ones.
    // A project's Python environment comes before that (`python` and `pip` are its own).
    let mut first: Vec<std::path::PathBuf> = path_prepend.unwrap_or_default().into_iter().map(std::path::PathBuf::from).filter(|d| d.is_dir()).collect();
    let java = java_bin(&jdk_home, "java");
    if let Some(bin) = java.parent().filter(|b| b.is_dir()) {
        if let Some(home) = bin.parent() {
            cmd.env("JAVA_HOME", home);
        }
        first.push(bin.to_path_buf());
    }
    if !first.is_empty() {
        let path = std::env::var_os("PATH").unwrap_or_default();
        let joined = std::env::join_paths(first.into_iter().chain(std::env::split_paths(&path))).map_err(err)?;
        cmd.env("PATH", joined);
    }
    for (k, v) in env.unwrap_or_default() {
        cmd.env(k, v);
    }
    let mut child = pty.slave.spawn_command(cmd).map_err(|e| format!("The shell couldn't be started: {e}"))?;
    drop(pty.slave);
    let mut reader = pty.master.try_clone_reader().map_err(err)?;
    let writer = pty.master.take_writer().map_err(err)?;
    let killer = child.clone_killer();
    state.0.lock().map_err(err)?.insert(id, Term { master: pty.master, writer, killer });

    let out = app.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        let mut pending = Vec::new();
        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 {
                break;
            }
            let data = decode(&mut pending, &buf[..n]);
            if !data.is_empty() {
                let _ = out.emit("term-data", Data { id, data });
            }
        }
    });
    // On Windows the output only ends when the console is closed, so the end of the shell closes it.
    let terms = state.inner().clone();
    std::thread::spawn(move || {
        let code = child.wait().ok().map(|s| s.exit_code());
        std::thread::sleep(std::time::Duration::from_millis(150));
        if let Ok(mut map) = terms.0.lock() {
            map.remove(&id);
        }
        let _ = app.emit("term-exit", Exit { id, code });
    });
    Ok(())
}

#[tauri::command]
pub fn term_write(state: State<Terminals>, id: u32, data: String) -> Result<(), String> {
    let mut map = state.0.lock().map_err(err)?;
    let t = map.get_mut(&id).ok_or("The terminal has closed.")?;
    t.writer.write_all(data.as_bytes()).map_err(err)?;
    t.writer.flush().map_err(err)
}

#[tauri::command]
pub fn term_resize(state: State<Terminals>, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    let map = state.0.lock().map_err(err)?;
    if let Some(t) = map.get(&id) {
        t.master.resize(PtySize { rows: rows.max(2), cols: cols.max(10), pixel_width: 0, pixel_height: 0 }).map_err(err)?;
    }
    Ok(())
}

#[tauri::command]
pub fn term_close(state: State<Terminals>, id: u32) {
    if let Ok(mut map) = state.0.lock() {
        if let Some(mut t) = map.remove(&id) {
            let _ = t.killer.kill();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_characters_split_between_reads() {
        let mut pending = Vec::new();
        let bytes = "Grüße €".as_bytes();
        // "ü" is two bytes and "€" three: cut through both.
        let a = decode(&mut pending, &bytes[..3]);
        let b = decode(&mut pending, &bytes[3..9]);
        let c = decode(&mut pending, &bytes[9..]);
        assert_eq!(format!("{a}{b}{c}"), "Grüße €");
        assert!(pending.is_empty());
    }

    #[test]
    fn finds_a_shell() {
        assert!(!term_shells().is_empty());
    }

    /// A real shell in a pseudo console: a command's output comes back, and the exit is seen.
    #[test]
    fn runs_a_shell() {
        let shell = &term_shells()[0];
        let pty = native_pty_system().openpty(PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 }).unwrap();
        let mut cmd = CommandBuilder::new(&shell.path);
        cmd.args(&shell.args);
        let mut child = pty.slave.spawn_command(cmd).unwrap();
        drop(pty.slave);
        let mut reader = pty.master.try_clone_reader().unwrap();
        let mut writer = pty.master.take_writer().unwrap();
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            let mut pending = Vec::new();
            while let Ok(n) = reader.read(&mut buf) {
                if n == 0 || tx.send(decode(&mut pending, &buf[..n])).is_err() {
                    break;
                }
            }
        });
        // ConPTY asks where the cursor is before it starts; a terminal (xterm.js in the app) answers.
        let mut seen = String::new();
        let start = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while std::time::Instant::now() < start {
            match rx.recv_timeout(std::time::Duration::from_millis(400)) {
                Ok(s) => {
                    seen.push_str(&s);
                    if seen.contains("\x1b[6n") {
                        writer.write_all(b"\x1b[1;1R").unwrap();
                        writer.flush().unwrap();
                        seen.clear();
                    }
                }
                Err(_) if !seen.is_empty() => break,
                Err(_) => {}
            }
        }
        // PowerShell and Bash both work out `$((6*7))`; only the printed answer has 42 in it.
        writer.write_all(b"echo logiq-$((6*7))\r").unwrap();
        writer.flush().unwrap();
        let mut seen = String::new();
        let end = std::time::Instant::now() + std::time::Duration::from_secs(15);
        while !seen.contains("logiq-42\r\n") && std::time::Instant::now() < end {
            if let Ok(s) = rx.recv_timeout(std::time::Duration::from_millis(200)) {
                seen.push_str(&s);
            }
        }
        assert!(seen.contains("logiq-42\r\n"), "output: {seen:?}");
        writer.write_all(b"exit\r").unwrap();
        writer.flush().unwrap();
        let status = child.wait().unwrap();
        assert!(status.success());
    }
}
