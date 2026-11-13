//! The live HTML preview. The open folder is served on its own origin
//! (`logiq-preview://localhost/…`, `http://logiq-preview.localhost/…` on
//! Windows), so a page's relative links to its CSS, scripts and images work
//! exactly as they would on a web server. Nothing outside the folder is served.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::http::{Request, Response};
use tauri::{AppHandle, Manager, State};

#[derive(Default)]
pub struct PreviewRoot(Mutex<Option<PathBuf>>);

#[tauri::command]
pub fn set_preview_root(state: State<PreviewRoot>, path: Option<String>) -> Result<(), String> {
    let root = match path {
        Some(p) => Some(std::fs::canonicalize(&p).map_err(|e| e.to_string())?),
        None => None,
    };
    *state.0.lock().map_err(|e| e.to_string())? = root;
    Ok(())
}

pub fn mime(path: &Path) -> &'static str {
    match path.extension().map(|e| e.to_string_lossy().to_lowercase()).as_deref() {
        Some("html" | "htm") => "text/html; charset=utf-8",
        Some("css") => "text/css; charset=utf-8",
        Some("js" | "mjs" | "cjs") => "text/javascript; charset=utf-8",
        Some("json" | "map") => "application/json; charset=utf-8",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("avif") => "image/avif",
        Some("ico") => "image/x-icon",
        Some("bmp") => "image/bmp",
        Some("woff") => "font/woff",
        Some("woff2") => "font/woff2",
        Some("ttf") => "font/ttf",
        Some("otf") => "font/otf",
        Some("mp3") => "audio/mpeg",
        Some("wav") => "audio/wav",
        Some("ogg") => "audio/ogg",
        Some("mp4") => "video/mp4",
        Some("webm") => "video/webm",
        Some("txt" | "md" | "java" | "csv") => "text/plain; charset=utf-8",
        Some("xml") => "application/xml",
        Some("wasm") => "application/wasm",
        Some("pdf") => "application/pdf",
        _ => "application/octet-stream",
    }
}

pub fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = |c: u8| (c as char).to_digit(16);
            if let (Some(h), Some(l)) = (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                out.push((h * 16 + l) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Resolves a request path inside the root, refusing anything that leaves it.
pub fn resolve(root: &Path, url_path: &str) -> Option<PathBuf> {
    let rel = percent_decode(url_path.split(['?', '#']).next().unwrap_or(""));
    let mut target = root.to_path_buf();
    for part in rel.split('/') {
        match part {
            "" | "." => {}
            ".." => return None,
            p => target.push(p),
        }
    }
    if target.is_dir() {
        target.push("index.html");
    }
    let real = std::fs::canonicalize(&target).ok()?;
    real.starts_with(root).then_some(real)
}

fn respond(status: u16, mime: &str, body: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header("Content-Type", mime)
        .header("Cache-Control", "no-store")
        .header("Access-Control-Allow-Origin", "*")
        .body(body)
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

pub fn serve(app: &AppHandle, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let root = app.state::<PreviewRoot>().0.lock().ok().and_then(|r| r.clone());
    let Some(root) = root else {
        return respond(404, "text/plain", b"No folder is open.".to_vec());
    };
    let Some(path) = resolve(&root, request.uri().path()) else {
        return respond(404, "text/html; charset=utf-8", NOT_FOUND.as_bytes().to_vec());
    };
    match std::fs::read(&path) {
        Ok(bytes) => respond(200, mime(&path), bytes),
        Err(_) => respond(404, "text/html; charset=utf-8", NOT_FOUND.as_bytes().to_vec()),
    }
}

const NOT_FOUND: &str = "<!doctype html><meta charset=utf-8><body style=\"font:14px system-ui;color:#8a909b;display:grid;place-items:center;height:90vh\">This file was not found in the open folder.</body>";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stays_inside_the_root() {
        let dir = std::env::temp_dir().join(format!("logiq-preview-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("css")).unwrap();
        std::fs::write(dir.join("index.html"), "x").unwrap();
        std::fs::write(dir.join("css/my style.css"), "x").unwrap();
        let root = std::fs::canonicalize(&dir).unwrap();
        assert!(resolve(&root, "/").unwrap().ends_with("index.html"));
        assert!(resolve(&root, "/css/my%20style.css?v=2").is_some());
        assert!(resolve(&root, "/../secret.txt").is_none());
        assert!(resolve(&root, "/missing.html").is_none());
        assert_eq!(mime(Path::new("a.CSS")), "text/css; charset=utf-8");
        assert_eq!(percent_decode("%C3%A4%2"), "\u{e4}%2");
        let _ = std::fs::remove_dir_all(dir);
    }
}
