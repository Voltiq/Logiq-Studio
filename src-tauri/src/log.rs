//! The log file and crash reports.
//!
//! Everything stays on this computer. The log (`logiq-studio.log` in the
//! app's log folder, one earlier file kept) records what the app did and
//! what went wrong: versions, failed commands, errors from the window. It
//! never holds the text of your files. When the app panics, a crash report
//! with the message, the place and a stack trace is written next to it, and
//! the next start offers to show it.

use serde::Serialize;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_LOG: u64 = 1024 * 1024;
const KEEP_CRASHES: usize = 10;

static DIR: OnceLock<PathBuf> = OnceLock::new();
static FILE: Mutex<Option<std::fs::File>> = Mutex::new(None);

/// Year, month, day, hour, minute, second in UTC for seconds since 1970.
pub fn civil(secs: u64) -> (i64, u32, u32, u32, u32, u32) {
    let days = (secs / 86400) as i64;
    let rem = (secs % 86400) as u32;
    // Days to a date in the proleptic Gregorian calendar (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = (if mp < 10 { mp + 3 } else { mp - 9 }) as u32;
    let y = yoe + era * 400 + i64::from(m <= 2);
    (y, m, d, rem / 3600, rem % 3600 / 60, rem % 60)
}

fn now() -> (i64, u32, u32, u32, u32, u32) {
    civil(SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0))
}

/// "2026-11-13 08:15:00" in UTC.
fn stamp() -> String {
    let (y, m, d, h, mi, s) = now();
    format!("{y:04}-{m:02}-{d:02} {h:02}:{mi:02}:{s:02}")
}

/// "20261113-081500", for file names that sort by time.
fn file_stamp() -> String {
    let (y, m, d, h, mi, s) = now();
    format!("{y:04}{m:02}{d:02}-{h:02}{mi:02}{s:02}")
}

fn log_path(dir: &Path) -> PathBuf {
    dir.join("logiq-studio.log")
}

/// Opens the log in `dir`, moving a full one aside, and installs the crash handler.
pub fn init(dir: PathBuf) {
    let _ = std::fs::create_dir_all(&dir);
    let path = log_path(&dir);
    if std::fs::metadata(&path).map(|m| m.len() > MAX_LOG).unwrap_or(false) {
        let _ = std::fs::rename(&path, dir.join("logiq-studio.previous.log"));
    }
    if let Ok(f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        if let Ok(mut slot) = FILE.lock() {
            *slot = Some(f);
        }
    }
    let _ = DIR.set(dir);
    write("info", &format!("Logiq Studio {} started on {} {}", env!("CARGO_PKG_VERSION"), std::env::consts::OS, std::env::consts::ARCH));

    let default = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let message = info
            .payload()
            .downcast_ref::<&str>()
            .map(|s| s.to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "unknown panic".to_string());
        let place = info.location().map(|l| format!("{}:{}", l.file(), l.line())).unwrap_or_default();
        crash(&message, &place, &std::backtrace::Backtrace::force_capture().to_string());
        default(info);
    }));
}

/// Appends a line to the log. Line breaks in the message are kept on one line.
pub fn write(level: &str, message: &str) {
    let line = format!("{} {:<5} {}\n", stamp(), level, message.replace(['\r', '\n'], " ⏎ "));
    if let Ok(mut slot) = FILE.lock() {
        if let Some(f) = slot.as_mut() {
            let _ = f.write_all(line.as_bytes());
        }
    }
}

fn crash(message: &str, place: &str, trace: &str) {
    write("crash", &format!("{message} at {place}"));
    let Some(dir) = DIR.get() else { return };
    let report = format!(
        "Logiq Studio crash report\n\nVersion: {}\nSystem: {} {}\nTime (UTC): {}\n\nWhat happened: {message}\nWhere: {place}\n\nStack trace:\n{trace}\n",
        env!("CARGO_PKG_VERSION"),
        std::env::consts::OS,
        std::env::consts::ARCH,
        stamp(),
    );
    let _ = std::fs::write(dir.join(format!("crash-{}.txt", file_stamp())), report);
}

fn crash_files(dir: &Path) -> Vec<PathBuf> {
    let mut files: Vec<PathBuf> = std::fs::read_dir(dir).map(|rd| rd.filter_map(|e| e.ok().map(|e| e.path())).collect()).unwrap_or_default();
    files.retain(|p| p.file_name().and_then(|n| n.to_str()).map(|n| n.starts_with("crash-") && n.ends_with(".txt")).unwrap_or(false));
    files.sort();
    files
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogInfo {
    pub folder: String,
    pub file: String,
    /// Crash reports not seen yet, newest last.
    pub new_crashes: Vec<String>,
}

/// Where the log is, and which crash reports are new since the user last looked.
#[tauri::command]
pub fn log_info() -> Result<LogInfo, String> {
    let dir = DIR.get().ok_or("The log is not available.")?;
    let files = crash_files(dir);
    // Old reports go; the list stays short.
    for old in files.iter().rev().skip(KEEP_CRASHES) {
        let _ = std::fs::remove_file(old);
    }
    let seen = std::fs::read_to_string(dir.join("crashes-seen.txt")).unwrap_or_default();
    let new_crashes = files
        .iter()
        .filter(|p| p.file_name().and_then(|n| n.to_str()).map(|n| n > seen.trim()).unwrap_or(false))
        .map(|p| p.to_string_lossy().to_string())
        .collect();
    Ok(LogInfo { folder: dir.to_string_lossy().to_string(), file: log_path(dir).to_string_lossy().to_string(), new_crashes })
}

/// Remembers that the crash reports so far have been shown.
#[tauri::command]
pub fn crashes_seen() {
    let Some(dir) = DIR.get() else { return };
    if let Some(last) = crash_files(dir).last().and_then(|p| p.file_name()).and_then(|n| n.to_str()) {
        let _ = std::fs::write(dir.join("crashes-seen.txt"), last);
    }
}

/// A line from the window: a failed command or an error in the interface.
#[tauri::command]
pub fn log_write(level: String, message: String) {
    let level = match level.as_str() {
        "error" | "warn" | "info" => level,
        _ => "info".to_string(),
    };
    let short: String = message.chars().take(2000).collect();
    write(&level, &short);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dates_from_seconds() {
        assert_eq!(civil(0), (1970, 1, 1, 0, 0, 0));
        // 2026-11-13 20:45:07 UTC
        assert_eq!(civil(1_794_602_707), (2026, 11, 13, 20, 45, 7));
        // A leap day.
        assert_eq!(civil(1_709_164_800), (2024, 2, 29, 0, 0, 0));
    }

    #[test]
    fn stamps_are_sortable() {
        let s = stamp();
        assert_eq!(s.len(), 19, "{s}");
        assert_eq!(&s[4..5], "-");
        assert_eq!(&s[13..14], ":");
        let f = file_stamp();
        assert_eq!(f.len(), 15, "{f}");
    }

    #[test]
    fn writes_the_log_and_lists_new_crashes() {
        let dir = std::env::temp_dir().join(format!("logiq-log-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("crash-20260101-000000.txt"), "old").unwrap();
        std::fs::write(dir.join("crashes-seen.txt"), "crash-20260101-000000.txt").unwrap();
        std::fs::write(dir.join("crash-20260202-000000.txt"), "new").unwrap();
        // Without the panic hook: only the file handling.
        let _ = DIR.set(dir.clone());
        *FILE.lock().unwrap() = std::fs::OpenOptions::new().create(true).append(true).open(log_path(&dir)).ok();
        log_write("error".into(), "first line\nsecond line".into());
        log_write("nonsense".into(), "x".repeat(5000));
        let text = std::fs::read_to_string(log_path(&dir)).unwrap();
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines.len(), 2);
        assert!(lines[0].ends_with("error first line ⏎ second line"), "{}", lines[0]);
        assert!(lines[1].contains(" info  ") && lines[1].len() < 2100);
        let info = log_info().unwrap();
        assert_eq!(info.new_crashes.len(), 1);
        assert!(info.new_crashes[0].ends_with("crash-20260202-000000.txt"));
        crashes_seen();
        assert!(log_info().unwrap().new_crashes.is_empty());
        *FILE.lock().unwrap() = None;
        let _ = std::fs::remove_dir_all(dir);
    }
}
