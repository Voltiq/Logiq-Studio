//! Watches the open folder and tells the page when files change outside the
//! editor, so the explorer, the UML diagram and open editors keep up.

use notify::{RecommendedWatcher, RecursiveMode, Watcher as _};
use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

#[derive(Default)]
pub struct Watcher(Mutex<Option<RecommendedWatcher>>);

fn ignored(path: &Path) -> bool {
    path.components().any(|c| {
        let s = c.as_os_str().to_string_lossy();
        s == ".git" || s == "node_modules" || s == "out" || s == "target"
    }) || path.to_string_lossy().ends_with(".logiq-save")
}

/// Watches `path` (replacing the previous folder); `None` stops watching.
#[tauri::command]
pub fn watch_folder(app: AppHandle, state: State<Watcher>, path: Option<String>) -> Result<(), String> {
    let mut slot = state.0.lock().map_err(|e| e.to_string())?;
    *slot = None;
    let Some(path) = path else { return Ok(()) };
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(event) = res else { return };
        if matches!(event.kind, notify::EventKind::Access(_)) {
            return;
        }
        let paths: Vec<String> = event
            .paths
            .iter()
            .filter(|p| !ignored(p))
            .map(|p| p.to_string_lossy().to_string())
            .collect();
        if !paths.is_empty() {
            let _ = app.emit("fs-changed", paths);
        }
    })
    .map_err(|e| e.to_string())?;
    watcher.watch(Path::new(&path), RecursiveMode::Recursive).map_err(|e| e.to_string())?;
    *slot = Some(watcher);
    Ok(())
}
