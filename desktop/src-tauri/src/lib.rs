//! Scribble Jr: Windows desktop shell (Tauri v2) for the ScratchJr web client.
//!
//! Hosts the unmodified ScratchJr web app (assembled into ../dist) and provides the
//! "tablet" native layer it expects through Rust commands. The in-page JS bridge
//! (../../tablet-desktop.js) is injected into every page load before page scripts and
//! calls these commands via `invoke`.
//!
//! Every command returns plain strings (or null) to mirror the iOS native layer.

mod db;
mod files;

use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::Connection;
use tauri::webview::{NewWindowResponse, PermissionKind, PermissionResponse, Url};
use tauri::{AppHandle, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;

/// Largest .sjr file `open_sjr` accepts.
const MAX_SJR_BYTES: u64 = 50 * 1024 * 1024;

struct AppState {
    data_dir: PathBuf,
    files_dir: PathBuf,
    db: Mutex<Connection>,
}

impl AppState {
    fn db(&self) -> std::sync::MutexGuard<'_, Connection> {
        // A panic while holding the lock cannot leave SQLite in a bad state; keep going.
        self.db.lock().unwrap_or_else(|p| p.into_inner())
    }
}

// ---------------------------------------------------------------------------------------
// Commands. `async` on a sync fn makes Tauri run it off the main (UI) thread.
// ---------------------------------------------------------------------------------------

#[tauri::command(async)]
fn db_stmt(state: State<'_, AppState>, json: String) -> String {
    db::stmt(&state.db(), &json)
}

#[tauri::command(async)]
fn db_query(state: State<'_, AppState>, json: String) -> String {
    db::query(&state.db(), &json)
}

#[tauri::command(async)]
fn file_write(state: State<'_, AppState>, name: String, base64: String) -> String {
    files::write(&state.files_dir, &name, &base64)
}

#[tauri::command(async)]
fn file_read(state: State<'_, AppState>, name: String) -> Option<String> {
    files::read(&state.files_dir, &name)
}

#[tauri::command(async)]
fn file_remove(state: State<'_, AppState>, name: String) -> String {
    files::remove(&state.files_dir, &name)
}

#[tauri::command]
fn md5_hex(s: String) -> String {
    use md5::{Digest, Md5};
    Md5::digest(s.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Port of iOS `cleanassets`: delete files with this suffix that no project JSON,
/// user shape or user background references.
#[tauri::command(async)]
fn clean_assets(state: State<'_, AppState>, ext: String) {
    if ext.is_empty() {
        return;
    }
    let conn = state.db();
    // On a query error, treat the file as referenced (never delete on uncertainty).
    let referenced = |sql: &str, value: &str| db::has_rows(&conn, sql, value).unwrap_or(true);
    for file in files::list_with_suffix(&state.files_dir, &ext) {
        if referenced("select id from projects where json LIKE ?", &format!("%{file}%"))
            || referenced("select id from usershapes where md5 = ?", &file)
            || referenced("select id from userbkgs where md5 = ?", &file)
        {
            continue;
        }
        files::remove(&state.files_dir, &file);
    }
}

#[tauri::command]
fn data_dir(state: State<'_, AppState>) -> String {
    state.data_dir.to_string_lossy().into_owned()
}

/// Native Save dialog (Documents, *.sjr); writes the decoded bytes. True if saved.
#[tauri::command]
async fn save_sjr(
    app: AppHandle,
    window: WebviewWindow,
    file_name: String,
    base64: String,
) -> bool {
    let Some(bytes) = files::decode_base64(&base64) else {
        return false;
    };
    let mut dialog = app
        .dialog()
        .file()
        .set_parent(&window)
        .set_title("Save Scribble Jr project")
        .add_filter("Project file (*.sjr)", &["sjr"])
        .set_file_name(sanitize_save_name(&file_name));
    if let Ok(docs) = app.path().document_dir() {
        dialog = dialog.set_directory(docs);
    }
    // blocking_* must not run on the main thread; spawn_blocking keeps the UI responsive.
    let chosen = tauri::async_runtime::spawn_blocking(move || dialog.blocking_save_file())
        .await
        .ok()
        .flatten();
    let Some(path) = chosen.and_then(|p| p.as_path().map(|p| p.to_path_buf())) else {
        return false;
    };
    tauri::async_runtime::spawn_blocking(move || fs::write(path, bytes).is_ok())
        .await
        .unwrap_or(false)
}

/// Native Open dialog filtered to *.sjr; returns base64 of the file (None if cancelled,
/// unreadable or larger than 50 MB).
#[tauri::command]
async fn open_sjr(app: AppHandle, window: WebviewWindow) -> Option<String> {
    let mut dialog = app
        .dialog()
        .file()
        .set_parent(&window)
        .set_title("Open Scribble Jr project")
        .add_filter("Project file (*.sjr)", &["sjr"]);
    if let Ok(docs) = app.path().document_dir() {
        dialog = dialog.set_directory(docs);
    }
    let chosen = tauri::async_runtime::spawn_blocking(move || dialog.blocking_pick_file())
        .await
        .ok()
        .flatten()?;
    let path = chosen.as_path()?.to_path_buf();
    tauri::async_runtime::spawn_blocking(move || {
        if fs::metadata(&path).ok()?.len() > MAX_SJR_BYTES {
            return None;
        }
        fs::read(&path).ok().map(|b| files::encode_base64(&b))
    })
    .await
    .ok()
    .flatten()
}

/// Default file name for the Save dialog: strip characters Windows does not allow and
/// make sure it ends in ".sjr".
fn sanitize_save_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .filter(|c| !matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') && !c.is_control())
        .collect();
    let cleaned = cleaned.trim().trim_matches('.').trim().to_string();
    let base = if cleaned.is_empty() { "Project".to_string() } else { cleaned };
    if base.to_ascii_lowercase().ends_with(".sjr") {
        base
    } else {
        format!("{base}.sjr")
    }
}

// ---------------------------------------------------------------------------------------
// Window / webview policy
// ---------------------------------------------------------------------------------------

/// True for the app's own origin. On Windows (WebView2) Tauri serves the embedded
/// frontend at http://tauri.localhost (https://tauri.localhost if useHttpsScheme);
/// other platforms use tauri://localhost.
fn is_app_origin(url: &Url) -> bool {
    match (url.scheme(), url.host_str()) {
        ("http" | "https", Some("tauri.localhost")) => true,
        ("tauri", Some("localhost")) => true,
        // Debug builds may load from a local dev server.
        ("http", Some("localhost" | "127.0.0.1")) => cfg!(debug_assertions),
        _ => false,
    }
}

fn create_main_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("Scribble Jr")
        .initialization_script(include_str!("../../tablet-desktop.js"))
        .maximized(true)
        .resizable(true)
        .min_inner_size(1024.0, 700.0)
        .decorations(true)
        // Never browse anywhere but the app itself (app-store / website links included).
        .on_navigation(|url| {
            let allowed = is_app_origin(url) || url.as_str() == "about:blank";
            if !allowed {
                eprintln!("[scribble-jr] blocked navigation to {url}");
            }
            allowed
        })
        // No popups: window.open / target=_blank are denied.
        .on_new_window(|url, _features| {
            eprintln!("[scribble-jr] blocked new window for {url}");
            NewWindowResponse::Deny
        })
        // getUserMedia: allow mic + camera for our own pages, deny everything else.
        .on_permission_request(|webview, kind| {
            let ours = webview.url().map(|u| is_app_origin(&u)).unwrap_or(false);
            match kind {
                PermissionKind::Microphone | PermissionKind::Camera if ours => {
                    PermissionResponse::Allow
                }
                _ => PermissionResponse::Deny,
            }
        })
        .build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let files_dir = data_dir.join("files");
            fs::create_dir_all(&files_dir)?;
            let conn = db::open(&data_dir.join("projects.db"))?;
            app.manage(AppState {
                data_dir,
                files_dir,
                db: Mutex::new(conn),
            });
            create_main_window(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db_stmt,
            db_query,
            file_write,
            file_read,
            file_remove,
            md5_hex,
            clean_assets,
            save_sjr,
            open_sjr,
            data_dir
        ])
        .run(tauri::generate_context!())
        .expect("error while running Scribble Jr");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn md5_matches_known_vector() {
        assert_eq!(md5_hex("hello".into()), "5d41402abc4b2a76b9719d911017c592");
        assert_eq!(md5_hex(String::new()), "d41d8cd98f00b204e9800998ecf8427e");
    }

    #[test]
    fn app_origin_policy() {
        assert!(is_app_origin(&Url::parse("http://tauri.localhost/index.html").unwrap()));
        assert!(is_app_origin(&Url::parse("https://tauri.localhost/editor.html?x=1").unwrap()));
        assert!(is_app_origin(&Url::parse("tauri://localhost/home.html").unwrap()));
        assert!(!is_app_origin(&Url::parse("https://www.scratchjr.org/").unwrap()));
        assert!(!is_app_origin(&Url::parse("https://tauri.localhost.evil.com/").unwrap()));
        assert!(!is_app_origin(&Url::parse("http://ipc.localhost/x").unwrap()));
        assert!(!is_app_origin(&Url::parse("file:///C:/Windows/").unwrap()));
    }

    #[test]
    fn save_name_sanitizing() {
        assert_eq!(sanitize_save_name("My Project"), "My Project.sjr");
        assert_eq!(sanitize_save_name("a/b:c?.sjr"), "abc.sjr");
        assert_eq!(sanitize_save_name("..."), "Project.sjr");
    }
}
