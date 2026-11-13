//! The project's files: listing, reading, writing, creating, renaming and
//! deleting (to the Recycle Bin). Every command takes absolute paths.

use serde::Serialize;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

/// Folders that never hold the user's sources: skipped by quick open,
/// find in files and the UML scan (the explorer still shows them).
pub const SKIPPED_DIRS: &[&str] = &[".git", "node_modules", "out", "target", "bin", "build", ".logiq", ".idea", ".vscode"];

/// Largest file the editor opens or a search looks into.
pub const MAX_TEXT_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    name: String,
    path: String,
    is_dir: bool,
    size: u64,
    modified: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextFile {
    pub text: String,
    /// "crlf" when most lines end in \r\n, otherwise "lf".
    pub eol: &'static str,
    pub modified: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    path: String,
    text: String,
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn modified_ms(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn is_skipped_dir(name: &str) -> bool {
    SKIPPED_DIRS.iter().any(|d| d.eq_ignore_ascii_case(name))
}

/// One folder's entries: folders first, then files, each in natural order.
#[tauri::command]
pub fn fs_list_dir(path: String) -> Result<Vec<Entry>, String> {
    let mut entries: Vec<Entry> = fs::read_dir(&path)
        .map_err(err)?
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let meta = e.metadata().ok()?;
            let name = e.file_name().to_string_lossy().to_string();
            if name == ".git" || name.ends_with(".logiq-save") {
                return None;
            }
            Some(Entry {
                path: e.path().to_string_lossy().to_string(),
                is_dir: meta.is_dir(),
                size: if meta.is_dir() { 0 } else { meta.len() },
                modified: modified_ms(&meta),
                name,
            })
        })
        .collect();
    entries.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then_with(|| natural_cmp(&a.name, &b.name)));
    Ok(entries)
}

/// Case-insensitive comparison that orders "File2" before "File10".
pub fn natural_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    use std::cmp::Ordering::*;
    let (mut x, mut y) = (a.chars().peekable(), b.chars().peekable());
    loop {
        match (x.peek().copied(), y.peek().copied()) {
            (None, None) => return a.cmp(b),
            (None, _) => return Less,
            (_, None) => return Greater,
            (Some(c), Some(d)) if c.is_ascii_digit() && d.is_ascii_digit() => {
                let mut n = String::new();
                while let Some(c) = x.peek().copied().filter(|c| c.is_ascii_digit()) {
                    n.push(c);
                    x.next();
                }
                let mut m = String::new();
                while let Some(d) = y.peek().copied().filter(|d| d.is_ascii_digit()) {
                    m.push(d);
                    y.next();
                }
                let (n, m) = (n.trim_start_matches('0'), m.trim_start_matches('0'));
                let o = n.len().cmp(&m.len()).then_with(|| n.cmp(m));
                if o != Equal {
                    return o;
                }
            }
            (Some(c), Some(d)) => {
                let o = c.to_lowercase().cmp(d.to_lowercase());
                if o != Equal {
                    return o;
                }
                x.next();
                y.next();
            }
        }
    }
}

pub fn looks_binary(bytes: &[u8]) -> bool {
    bytes.iter().take(8000).any(|&b| b == 0)
}

/// Decodes UTF-8, falling back to Windows-1252 (older school projects).
pub fn decode(bytes: &[u8]) -> String {
    let bytes = bytes.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(bytes);
    match std::str::from_utf8(bytes) {
        Ok(s) => s.to_string(),
        Err(_) => bytes.iter().map(|&b| cp1252(b)).collect(),
    }
}

#[tauri::command]
pub fn fs_read_text(path: String) -> Result<TextFile, String> {
    let meta = fs::metadata(&path).map_err(err)?;
    if meta.len() > MAX_TEXT_BYTES {
        return Err(format!("The file is larger than {} MB.", MAX_TEXT_BYTES / 1024 / 1024));
    }
    let bytes = fs::read(&path).map_err(err)?;
    if looks_binary(&bytes) {
        return Err("binary".into());
    }
    // A byte order mark is dropped; the file is written back without it.
    let text = decode(&bytes);
    let crlf = text.matches("\r\n").count();
    let lf = text.matches('\n').count();
    Ok(TextFile {
        eol: if crlf > 0 && crlf * 2 >= lf { "crlf" } else { "lf" },
        text: text.replace("\r\n", "\n"),
        modified: modified_ms(&meta),
    })
}

fn cp1252(b: u8) -> char {
    const HIGH: [char; 32] = [
        '\u{20ac}', '\u{81}', '\u{201a}', '\u{192}', '\u{201e}', '\u{2026}', '\u{2020}', '\u{2021}', '\u{2c6}', '\u{2030}',
        '\u{160}', '\u{2039}', '\u{152}', '\u{8d}', '\u{17d}', '\u{8f}', '\u{90}', '\u{2018}', '\u{2019}', '\u{201c}',
        '\u{201d}', '\u{2022}', '\u{2013}', '\u{2014}', '\u{2dc}', '\u{2122}', '\u{161}', '\u{203a}', '\u{153}', '\u{9d}',
        '\u{17e}', '\u{178}',
    ];
    match b {
        0x80..=0x9f => HIGH[(b - 0x80) as usize],
        _ => b as char,
    }
}

/// Writes next to the file first and then swaps it in, so a failed save never
/// leaves half a file behind. Returns the new modification time.
#[tauri::command]
pub fn fs_write_text(path: String, text: String, eol: Option<String>) -> Result<u64, String> {
    let text = if eol.as_deref() == Some("crlf") { text.replace('\n', "\r\n") } else { text };
    let target = PathBuf::from(&path);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(err)?;
    }
    let tmp = target.with_file_name(format!(
        ".{}.logiq-save",
        target.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()
    ));
    {
        let mut f = fs::File::create(&tmp).map_err(err)?;
        f.write_all(text.as_bytes()).map_err(err)?;
        f.sync_all().map_err(err)?;
    }
    if let Err(e) = fs::rename(&tmp, &target) {
        // Some synced folders hold the target open; fall back to a direct write.
        let _ = fs::remove_file(&tmp);
        fs::write(&target, text.as_bytes()).map_err(|_| err(e))?;
    }
    Ok(fs::metadata(&target).map(|m| modified_ms(&m)).unwrap_or(0))
}

/// Writes binary data, such as an exported PNG of the UML diagram.
#[tauri::command]
pub fn fs_write_bytes(path: String, bytes: Vec<u8>) -> Result<(), String> {
    fs::write(&path, bytes).map_err(err)
}

fn exists_error(p: &Path) -> String {
    format!("\u{201c}{}\u{201d} already exists.", p.file_name().unwrap_or_default().to_string_lossy())
}

#[tauri::command]
pub fn fs_create_file(path: String, text: Option<String>) -> Result<(), String> {
    let p = Path::new(&path);
    if p.exists() {
        return Err(exists_error(p));
    }
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(err)?;
    }
    fs::write(p, text.unwrap_or_default()).map_err(err)
}

#[tauri::command]
pub fn fs_create_dir(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if p.exists() {
        return Err(exists_error(p));
    }
    fs::create_dir_all(p).map_err(err)
}

#[tauri::command]
pub fn fs_rename(from: String, to: String) -> Result<(), String> {
    let (a, b) = (Path::new(&from), Path::new(&to));
    // A change of case only is allowed on Windows even though the target "exists".
    if b.exists() && from.to_lowercase() != to.to_lowercase() {
        return Err(exists_error(b));
    }
    fs::rename(a, b).map_err(err)
}

/// Copies a file or a whole folder. The target must not exist yet.
#[tauri::command]
pub fn fs_copy(from: String, to: String) -> Result<(), String> {
    let (a, b) = (Path::new(&from), Path::new(&to));
    if b.exists() {
        return Err(exists_error(b));
    }
    if b.starts_with(a) {
        return Err("A folder can't be copied into itself.".into());
    }
    copy_recursive(a, b).map_err(err)
}

fn copy_recursive(a: &Path, b: &Path) -> std::io::Result<()> {
    if a.is_dir() {
        fs::create_dir_all(b)?;
        for e in fs::read_dir(a)? {
            let e = e?;
            copy_recursive(&e.path(), &b.join(e.file_name()))?;
        }
        Ok(())
    } else {
        fs::copy(a, b).map(|_| ())
    }
}

/// Moves to the Recycle Bin, so a deletion can be undone there.
#[tauri::command]
pub fn fs_delete(path: String) -> Result<(), String> {
    trash::delete(&path).map_err(err)
}

#[tauri::command]
pub fn fs_exists(path: String) -> bool {
    Path::new(&path).exists()
}

/// Walks a folder depth first in natural order, skipping build output and tool folders.
pub fn walk(root: &Path, limit: usize, visit: &mut dyn FnMut(&Path)) {
    let mut stack = vec![root.to_path_buf()];
    let mut count = 0;
    while let Some(dir) = stack.pop() {
        let Ok(rd) = fs::read_dir(&dir) else { continue };
        let mut children: Vec<_> = rd.filter_map(|e| e.ok()).collect();
        children.sort_by(|a, b| natural_cmp(&a.file_name().to_string_lossy(), &b.file_name().to_string_lossy()));
        let mut dirs = Vec::new();
        for e in children {
            let Ok(ft) = e.file_type() else { continue };
            let name = e.file_name().to_string_lossy().to_string();
            if ft.is_dir() {
                if !is_skipped_dir(&name) {
                    dirs.push(e.path());
                }
            } else if ft.is_file() {
                visit(&e.path());
                count += 1;
                if count >= limit {
                    return;
                }
            }
        }
        stack.extend(dirs.into_iter().rev());
    }
}

/// Every file under the folder (relative paths with forward slashes), for quick open.
#[tauri::command]
pub async fn fs_list_files(root: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let base = PathBuf::from(&root);
        let mut out = Vec::new();
        walk(&base, 50_000, &mut |p| {
            if let Ok(rel) = p.strip_prefix(&base) {
                out.push(rel.to_string_lossy().replace('\\', "/"));
            }
        });
        out
    })
    .await
    .map_err(err)
}

/// The text of every file with the extension, for the UML diagram.
#[tauri::command]
pub async fn fs_read_sources(root: String, extension: String) -> Result<Vec<Source>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let ext = extension.trim_start_matches('.').to_lowercase();
        let mut out = Vec::new();
        walk(Path::new(&root), 20_000, &mut |p| {
            let matches = p.extension().map(|e| e.to_string_lossy().to_lowercase() == ext).unwrap_or(false);
            if !matches {
                return;
            }
            if let Ok(f) = fs_read_text(p.to_string_lossy().to_string()) {
                out.push(Source { path: p.to_string_lossy().to_string(), text: f.text });
            }
        });
        out
    })
    .await
    .map_err(err)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn natural_order() {
        let mut v = vec!["File10.java", "file2.java", "File1.java", "a.java"];
        v.sort_by(|a, b| natural_cmp(a, b));
        assert_eq!(v, vec!["a.java", "File1.java", "file2.java", "File10.java"]);
    }

    #[test]
    fn write_read_round_trip_keeps_line_endings() {
        let dir = std::env::temp_dir().join(format!("logiq-fs-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("A.java").to_string_lossy().to_string();
        fs_write_text(file.clone(), "class A {\n}\n".into(), Some("crlf".into())).unwrap();
        assert_eq!(fs::read(&file).unwrap(), b"class A {\r\n}\r\n");
        let read = fs_read_text(file.clone()).unwrap();
        assert_eq!(read.text, "class A {\n}\n");
        assert_eq!(read.eol, "crlf");
        fs::write(&file, [b'a', 0xE4, b'b']).unwrap();
        assert_eq!(fs_read_text(file).unwrap().text, "a\u{e4}b");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn copies_folders() {
        let dir = std::env::temp_dir().join(format!("logiq-copy-{}", std::process::id()));
        fs::create_dir_all(dir.join("a/b")).unwrap();
        fs::write(dir.join("a/b/X.java"), "x").unwrap();
        let (a, c) = (dir.join("a").to_string_lossy().to_string(), dir.join("c").to_string_lossy().to_string());
        fs_copy(a.clone(), c.clone()).unwrap();
        assert_eq!(fs::read_to_string(dir.join("c/b/X.java")).unwrap(), "x");
        assert!(fs_copy(a.clone(), c).is_err());
        assert!(fs_copy(a.clone(), dir.join("a/b/z").to_string_lossy().to_string()).is_err());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn walk_skips_build_output() {
        let dir = std::env::temp_dir().join(format!("logiq-walk-{}", std::process::id()));
        fs::create_dir_all(dir.join("out")).unwrap();
        fs::create_dir_all(dir.join("src")).unwrap();
        fs::write(dir.join("out/A.class"), "x").unwrap();
        fs::write(dir.join("src/A.java"), "x").unwrap();
        fs::write(dir.join("B.java"), "x").unwrap();
        let mut seen = Vec::new();
        walk(&dir, 100, &mut |p| seen.push(p.file_name().unwrap().to_string_lossy().to_string()));
        assert_eq!(seen, vec!["B.java", "A.java"]);
        let _ = fs::remove_dir_all(dir);
    }
}
