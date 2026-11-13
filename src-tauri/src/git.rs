//! Git through the `git` command line, so the user's own configuration,
//! hooks and credential manager apply. The page builds the commands and
//! reads their output; this side runs them without a console window and
//! never lets git wait for a password prompt in the background.

use crate::runner::no_window;
use serde::Serialize;
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// Where git is: on the PATH, or where Git for Windows installs itself.
pub fn git_bin() -> PathBuf {
    let name = if cfg!(windows) { "git.exe" } else { "git" };
    if let Some(p) = std::env::var_os("PATH").and_then(|p| std::env::split_paths(&p).map(|d| d.join(name)).find(|f| f.is_file())) {
        return p;
    }
    if cfg!(windows) {
        for base in [std::env::var_os("ProgramFiles"), std::env::var_os("LOCALAPPDATA").map(|l| Path::new(&l).join("Programs").into_os_string())].into_iter().flatten() {
            let p = Path::new(&base).join("Git").join("cmd").join("git.exe");
            if p.is_file() {
                return p;
            }
        }
    }
    PathBuf::from(name)
}

fn command(cwd: &str, args: &[String]) -> Command {
    let mut cmd = Command::new(git_bin());
    // Paths in UTF-8 and unquoted, no colours and no pager, whatever the user's config says.
    cmd.args(["-c", "core.quotepath=false", "-c", "color.ui=never", "-c", "core.pager=cat"]).args(args);
    if !cwd.is_empty() && Path::new(cwd).is_dir() {
        cmd.current_dir(cwd);
    }
    cmd.env("GIT_TERMINAL_PROMPT", "0").env("GIT_OPTIONAL_LOCKS", "0").env("LANG", "C.UTF-8");
    no_window(&mut cmd);
    cmd
}

#[derive(Serialize)]
pub struct GitResult {
    code: i32,
    stdout: String,
    stderr: String,
}

#[derive(Serialize)]
pub struct GitInfo {
    version: String,
    name: String,
    email: String,
}

/// Git's version and the user's name and e-mail, or None when git isn't installed.
#[tauri::command]
pub async fn git_info() -> Option<GitInfo> {
    tauri::async_runtime::spawn_blocking(|| {
        let run = |args: &[&str]| {
            let args: Vec<String> = args.iter().map(|a| a.to_string()).collect();
            command("", &args).output().ok().filter(|o| o.status.success()).map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        };
        let version = run(&["--version"])?;
        Some(GitInfo {
            version: version.trim_start_matches("git version ").to_string(),
            name: run(&["config", "--global", "user.name"]).unwrap_or_default(),
            email: run(&["config", "--global", "user.email"]).unwrap_or_default(),
        })
    })
    .await
    .ok()
    .flatten()
}

/// Runs git in `cwd` and returns what it printed. `input` goes to its standard input.
#[tauri::command]
pub async fn git_exec(cwd: String, args: Vec<String>, input: Option<String>) -> Result<GitResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = command(&cwd, &args);
        cmd.stdin(if input.is_some() { Stdio::piped() } else { Stdio::null() }).stdout(Stdio::piped()).stderr(Stdio::piped());
        let mut child = cmd.spawn().map_err(|e| format!("Git couldn't be started: {e}"))?;
        if let (Some(text), Some(mut stdin)) = (input, child.stdin.take()) {
            std::thread::spawn(move || {
                let _ = stdin.write_all(text.as_bytes());
            });
        }
        let out = child.wait_with_output().map_err(err)?;
        Ok(GitResult { code: out.status.code().unwrap_or(-1), stdout: String::from_utf8_lossy(&out.stdout).into_owned(), stderr: String::from_utf8_lossy(&out.stderr).into_owned() })
    })
    .await
    .map_err(err)?
}

/// A file's bytes at a revision (`HEAD:src/A.java`, `:src/A.java` for the staged copy); None when it isn't there.
#[tauri::command]
pub async fn git_show_file(cwd: String, spec: String) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || {
        let out = command(&cwd, &["show".into(), spec]).stdin(Stdio::null()).output().ok()?;
        out.status.success().then(|| String::from_utf8_lossy(&out.stdout).into_owned())
    })
    .await
    .ok()
    .flatten()
}

#[derive(Default, Clone)]
pub struct GitJobs(Arc<Mutex<HashMap<u32, Child>>>);

#[derive(Serialize, Clone)]
struct Progress {
    id: u32,
    line: String,
}

#[derive(Serialize, Clone)]
struct Done {
    id: u32,
    code: i32,
}

/// Runs a long git command (clone, fetch, pull, push), sending its progress
/// lines as "git-progress" and its end as "git-done".
#[tauri::command]
pub fn git_stream(app: AppHandle, jobs: State<GitJobs>, id: u32, cwd: String, args: Vec<String>) -> Result<(), String> {
    let line_app = app.clone();
    stream(
        jobs.inner().clone(),
        id,
        &cwd,
        &args,
        move |line| {
            let _ = line_app.emit("git-progress", Progress { id, line });
        },
        move |code| {
            let _ = app.emit("git-done", Done { id, code });
        },
    )
}

/// Runs git with every output line (and every redrawn progress line) going to `on_line`, then `on_done` with the exit code.
pub fn stream(jobs: GitJobs, id: u32, cwd: &str, args: &[String], on_line: impl Fn(String) + Send + Sync + 'static, on_done: impl FnOnce(i32) + Send + 'static) -> Result<(), String> {
    let mut cmd = command(cwd, args);
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| format!("Git couldn't be started: {e}"))?;
    let stdout = child.stdout.take().ok_or("no output")?;
    let stderr = child.stderr.take().ok_or("no output")?;
    jobs.0.lock().map_err(err)?.insert(id, child);
    let on_line = Arc::new(on_line);
    let out_line = on_line.clone();
    let t1 = std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            out_line(line);
        }
    });
    let t2 = std::thread::spawn(move || {
        // Progress ends its lines with \r to redraw them; each one is sent.
        let mut r = BufReader::new(stderr);
        let mut buf = Vec::new();
        let mut byte = [0u8; 1];
        while r.read(&mut byte).map(|n| n > 0).unwrap_or(false) {
            if byte[0] == b'\n' || byte[0] == b'\r' {
                if !buf.is_empty() {
                    on_line(String::from_utf8_lossy(&buf).into_owned());
                    buf.clear();
                }
            } else {
                buf.push(byte[0]);
            }
        }
        if !buf.is_empty() {
            on_line(String::from_utf8_lossy(&buf).into_owned());
        }
    });
    std::thread::spawn(move || {
        let _ = t1.join();
        let _ = t2.join();
        let child = jobs.0.lock().ok().and_then(|mut m| m.remove(&id));
        let code = child.and_then(|mut c| c.wait().ok()).and_then(|s| s.code()).unwrap_or(-1);
        on_done(code);
    });
    Ok(())
}

#[tauri::command]
pub fn git_cancel(jobs: State<GitJobs>, id: u32) {
    if let Ok(mut map) = jobs.0.lock() {
        if let Some(c) = map.get_mut(&id) {
            let _ = c.kill();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(cwd: &Path, args: &[&str]) -> String {
        let args: Vec<String> = args.iter().map(|a| a.to_string()).collect();
        let out = command(&cwd.to_string_lossy(), &args).output().unwrap();
        assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
        String::from_utf8_lossy(&out.stdout).into_owned()
    }

    /// The commands the page uses, on a real repository: status, staging, commit, log, show, branches.
    #[test]
    fn works_with_a_repository() {
        let dir = std::env::temp_dir().join("logiq-git-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("src")).unwrap();
        run(&dir, &["init", "-q", "-b", "main"]);
        run(&dir, &["config", "user.name", "Test"]);
        run(&dir, &["config", "user.email", "test@example.invalid"]);
        std::fs::write(dir.join("src").join("Grüße.java"), "class A {}\n").unwrap();
        let status = run(&dir, &["status", "--porcelain=v1", "-b", "-z", "-uall"]);
        assert!(status.contains("?? src/Grüße.java"), "{status:?}");
        run(&dir, &["add", "--", "src/Grüße.java"]);
        run(&dir, &["commit", "-q", "-m", "First"]);
        std::fs::write(dir.join("src").join("Grüße.java"), "class A { int x; }\n").unwrap();
        let status = run(&dir, &["status", "--porcelain=v1", "-b", "-z", "-uall"]);
        assert!(status.starts_with("## main"), "{status:?}");
        assert!(status.contains(" M src/Grüße.java"), "{status:?}");
        let head = run(&dir, &["show", "HEAD:src/Grüße.java"]);
        assert_eq!(head, "class A {}\n");
        let log = run(&dir, &["log", "-n", "5", "--format=%H%x1f%s%x1e"]);
        assert!(log.contains("\u{1f}First\u{1e}"));
        run(&dir, &["branch", "feature"]);
        let branches = run(&dir, &["branch", "--format=%(refname:short)"]);
        assert!(branches.contains("feature") && branches.contains("main"));

        // Clone it through the streaming runner, commit in the clone and push back.
        let copy = std::env::temp_dir().join("logiq-git-test-clone");
        let _ = std::fs::remove_dir_all(&copy);
        let (tx, rx) = std::sync::mpsc::channel::<Result<String, i32>>();
        let done = tx.clone();
        let args: Vec<String> = ["clone", "--progress", &dir.to_string_lossy(), &copy.to_string_lossy()].iter().map(|s| s.to_string()).collect();
        stream(GitJobs::default(), 1, &std::env::temp_dir().to_string_lossy(), &args, move |l| drop(tx.send(Ok(l))), move |c| drop(done.send(Err(c)))).unwrap();
        let mut lines = Vec::new();
        let code = loop {
            match rx.recv_timeout(std::time::Duration::from_secs(30)).expect("clone timed out") {
                Ok(l) => lines.push(l),
                Err(c) => break c,
            }
        };
        assert_eq!(code, 0, "{lines:?}");
        assert!(lines.iter().any(|l| l.starts_with("Cloning into")), "{lines:?}");
        assert!(copy.join("src").join("Grüße.java").is_file());
        // Push to a branch that is not checked out in the original.
        run(&copy, &["config", "user.name", "Test"]);
        run(&copy, &["config", "user.email", "test@example.invalid"]);
        run(&copy, &["switch", "-q", "feature"]);
        std::fs::write(copy.join("B.java"), "class B {}\n").unwrap();
        run(&copy, &["add", "-A"]);
        run(&copy, &["commit", "-q", "-m", "Add B"]);
        let status = run(&copy, &["status", "--porcelain=v1", "-b", "-z"]);
        assert!(status.starts_with("## feature...origin/feature [ahead 1]"), "{status:?}");
        run(&copy, &["push", "-q"]);
        let log = run(&dir, &["log", "feature", "-n", "1", "--format=%s"]);
        assert_eq!(log.trim(), "Add B");
    }
}
