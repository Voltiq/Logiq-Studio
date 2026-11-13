//! Logiq Studio: the native side of the IDE.
//!
//! The web view does the editing, the Java structure parsing and the UML
//! diagram. This side does what a page cannot: reading and writing the
//! project's files, watching the folder, searching it, finding a JDK,
//! compiling and running programs with live output, and serving the folder
//! to the HTML preview.

mod bench;
mod debug;
mod fs;
mod preview;
mod runner;
mod search;
mod tools;
mod watch;

use tauri::{Emitter, Manager};

/// Folders or files given on the command line ("Open with Logiq Studio").
#[tauri::command]
fn launch_paths() -> Vec<String> {
    paths_from_args(std::env::args().skip(1), std::env::current_dir().unwrap_or_default())
}

fn paths_from_args(args: impl Iterator<Item = String>, cwd: std::path::PathBuf) -> Vec<String> {
    args.filter(|a| !a.starts_with('-'))
        .map(|a| {
            let p = std::path::PathBuf::from(&a);
            if p.is_absolute() {
                p
            } else {
                cwd.join(p)
            }
        })
        .filter(|p| p.exists())
        .map(|p| p.to_string_lossy().to_string())
        .collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // First, so a second start hands its folder over before anything else happens.
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            let paths = paths_from_args(args.into_iter().skip(1), std::path::PathBuf::from(cwd));
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
            if !paths.is_empty() {
                let _ = app.emit("open-paths", paths);
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(runner::Runner::default())
        .manage(bench::Bench::default())
        .manage(debug::Debugger::default())
        .manage(tools::JShell::default())
        .manage(watch::Watcher::default())
        .manage(preview::PreviewRoot::default())
        .register_uri_scheme_protocol("logiq-preview", |ctx, request| preview::serve(ctx.app_handle(), &request))
        .setup(|app| {
            // The window starts hidden and the page shows it once its theme is
            // applied. Show it anyway if the page never gets that far.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(4));
                if let Some(window) = handle.get_webview_window("main") {
                    if !window.is_visible().unwrap_or(true) {
                        let _ = window.show();
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            launch_paths,
            fs::fs_list_dir,
            fs::fs_read_text,
            fs::fs_write_text,
            fs::fs_write_bytes,
            fs::fs_create_file,
            fs::fs_create_dir,
            fs::fs_rename,
            fs::fs_copy,
            fs::fs_delete,
            fs::fs_exists,
            fs::fs_list_files,
            fs::fs_read_sources,
            search::search_workspace,
            watch::watch_folder,
            preview::set_preview_root,
            runner::detect_jdks,
            runner::detect_node,
            runner::java_compile,
            runner::run_java,
            runner::run_node,
            runner::run_stdin,
            runner::run_stop,
            bench::bench_start,
            bench::bench_send,
            bench::bench_stop,
            debug::debug_start,
            debug::debug_send,
            debug::debug_stop,
            tools::jshell_start,
            tools::jshell_send,
            tools::jshell_stop,
            tools::jar_export,
            tools::javadoc_generate,
            tools::junit_find,
            tools::junit_download,
            tools::junit_run,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Logiq Studio");
}
