//! Stylelint for CSS, SCSS and Less: the project's own Stylelint (from its
//! `node_modules`), run with Node.js so the project's configuration and
//! plugins apply, as the Stylelint extension for VS Code does it.

use crate::runner::no_window;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// The project's Stylelint command line script, if it has one.
pub fn stylelint_bin(root: &Path) -> Option<PathBuf> {
    let base = root.join("node_modules").join("stylelint").join("bin");
    ["stylelint.mjs", "stylelint.js", "stylelint.cjs"].iter().map(|n| base.join(n)).find(|p| p.is_file())
}

#[tauri::command]
pub fn stylelint_available(root: String) -> bool {
    stylelint_bin(Path::new(&root)).is_some()
}

/// Lints `text` as the file `path` and returns Stylelint's JSON report.
#[tauri::command]
pub async fn stylelint_run(root: String, path: String, text: String, node: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = PathBuf::from(root);
        let bin = stylelint_bin(&root).ok_or("Stylelint isn't installed in this project (npm install --save-dev stylelint).")?;
        let node = node.filter(|n| !n.is_empty()).unwrap_or_else(|| if cfg!(windows) { "node.exe".into() } else { "node".into() });
        let mut cmd = Command::new(node);
        cmd.current_dir(&root)
            .arg(&bin)
            .args(["--stdin", "--stdin-filename"])
            .arg(&path)
            .args(["--formatter", "json", "--allow-empty-input"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let mut child = no_window(&mut cmd).spawn().map_err(|e| format!("Node.js couldn't be started: {e}"))?;
        if let Some(mut stdin) = child.stdin.take() {
            std::thread::spawn(move || {
                let _ = stdin.write_all(text.as_bytes());
            });
        }
        let out = child.wait_with_output().map_err(|e| e.to_string())?;
        // The report is on standard output in older versions and on standard error from Stylelint 16.
        let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
        let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
        let report = [stdout.trim(), stderr.trim()].into_iter().find(|s| s.starts_with('[')).map(str::to_string);
        match report {
            Some(r) => Ok(r),
            // No report: a configuration problem, which Stylelint explains.
            None if !out.status.success() => Err(stderr.lines().find(|l| !l.trim().is_empty()).unwrap_or("Stylelint stopped.").trim().to_string()),
            None => Ok("[]".into()),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_projects_stylelint() {
        let dir = std::env::temp_dir().join("logiq-stylelint-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        assert!(stylelint_bin(&dir).is_none());
        let bin = dir.join("node_modules").join("stylelint").join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        std::fs::write(bin.join("stylelint.mjs"), "").unwrap();
        assert_eq!(stylelint_bin(&dir), Some(bin.join("stylelint.mjs")));
    }
}
