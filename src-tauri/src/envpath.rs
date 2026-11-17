//! The PATH as Windows has it now. A program installed while Logiq Studio runs (a JDK, a compiler) adds its
//! folder to the PATH in the registry, but a running program keeps the PATH it started with. Reading it again
//! lets the tools be found, and the terminals opened afterwards run them, without restarting.

use std::ffi::OsString;
use std::path::PathBuf;
use std::process::Command;

/// Expands `%NAME%` references with the environment's values (unknown ones stay as they are).
pub fn expand(value: &str) -> String {
    let mut out = String::new();
    let mut rest = value;
    while let Some(start) = rest.find('%') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        match after.find('%') {
            Some(end) => {
                let name = &after[..end];
                match std::env::var(name) {
                    Ok(v) if !name.is_empty() => out.push_str(&v),
                    _ => {
                        out.push('%');
                        out.push_str(name);
                        out.push('%');
                    }
                }
                rest = &after[end + 1..];
            }
            None => {
                out.push_str(&rest[start..]);
                rest = "";
            }
        }
    }
    out.push_str(rest);
    out
}

/// The value of `Path` in `reg query` output: `    Path    REG_EXPAND_SZ    C:\a;%USERPROFILE%\b`.
pub fn parse_reg_path(output: &str) -> Option<String> {
    output.lines().find_map(|line| {
        let line = line.trim_start();
        if !line.to_ascii_lowercase().starts_with("path ") {
            return None;
        }
        let at = line.find("REG_")?;
        let after = &line[at..];
        let value_at = after.find(char::is_whitespace)?;
        Some(after[value_at..].trim().to_string())
    })
}

#[cfg(windows)]
fn registry_path(key: &str) -> Option<String> {
    let mut cmd = Command::new("reg");
    cmd.args(["query", key, "/v", "Path"]);
    let out = crate::runner::no_window(&mut cmd).output().ok()?;
    if !out.status.success() {
        return None;
    }
    parse_reg_path(&crate::fs::decode(&out.stdout)).map(|v| expand(&v))
}

/// Joins PATH lists: the first ones first, then what the later ones add; each folder once.
pub fn merge(lists: &[String]) -> Vec<PathBuf> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for list in lists {
        for p in std::env::split_paths(&OsString::from(list)) {
            let key = p.to_string_lossy().trim_end_matches(['\\', '/']).to_lowercase();
            if key.is_empty() || !seen.insert(key) {
                continue;
            }
            out.push(p);
        }
    }
    out
}

/// Takes in the PATH of the system and of the user as they are now; the process's own entries are kept after them.
#[cfg(windows)]
pub fn refresh() {
    let machine = registry_path(r"HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment").unwrap_or_default();
    let user = registry_path(r"HKCU\Environment").unwrap_or_default();
    let current = std::env::var("PATH").unwrap_or_default();
    if machine.is_empty() && user.is_empty() {
        return;
    }
    if let Ok(joined) = std::env::join_paths(merge(&[machine, user, current])) {
        std::env::set_var("PATH", joined);
    }
}

#[cfg(not(windows))]
pub fn refresh() {}

/// Reads the PATH again (after installing a language), for the searches and terminals that follow.
#[tauri::command]
pub async fn env_refresh_path() {
    let _ = tauri::async_runtime::spawn_blocking(refresh).await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_path_value() {
        let out = "\r\nHKEY_CURRENT_USER\\Environment\r\n    Path    REG_EXPAND_SZ    %USERPROFILE%\\bin;C:\\Tools Dir\\x\r\n\r\n";
        assert_eq!(parse_reg_path(out).as_deref(), Some("%USERPROFILE%\\bin;C:\\Tools Dir\\x"));
        assert_eq!(parse_reg_path("ERROR: nothing"), None);
    }

    #[test]
    fn expands_variables() {
        std::env::set_var("LOGIQ_TEST_DIR", r"C:\Users\Ada");
        assert_eq!(expand(r"%LOGIQ_TEST_DIR%\bin;%NOT_SET_LOGIQ%\x;50%"), r"C:\Users\Ada\bin;%NOT_SET_LOGIQ%\x;50%");
    }

    #[test]
    fn merges_without_repeats() {
        let m = merge(&[r"C:\A;C:\B\".into(), r"c:\b;C:\C".into(), r"C:\A;D:\E".into()]);
        let s: Vec<String> = m.iter().map(|p| p.to_string_lossy().to_string()).collect();
        assert_eq!(s, vec![r"C:\A", r"C:\B\", r"C:\C", r"D:\E"]);
    }
}
