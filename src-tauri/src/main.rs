// Giganoid 3D as a desktop app: a native window running the game in the system WebView2 engine.
// Everything the game saves (settings, level disks, custom sounds) lives in a folder next to the exe.
// At startup the game asks for the .adf disk images sitting next to the exe (and one folder level below).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::{Path, PathBuf};
use tauri::{WebviewUrl, WebviewWindowBuilder};

const ADF_SIZE: u64 = 901_120; // an Amiga DD disk image
const DATA_DIR: &str = "Giganoid3D-data";

fn base_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(Path::to_path_buf))
        .unwrap_or_default()
}

fn adfs_in(dir: &Path, out: &mut Vec<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let p = e.path();
        let is_adf = p
            .extension()
            .map(|x| x.to_string_lossy().eq_ignore_ascii_case("adf"))
            .unwrap_or(false);
        if is_adf && e.metadata().map(|m| m.is_file() && m.len() == ADF_SIZE).unwrap_or(false) {
            out.push(p.to_string_lossy().into_owned());
        }
    }
}

/// .adf files in the exe's folder, then in each sub-folder (one level deep), in name order
#[tauri::command]
fn list_adfs() -> Vec<String> {
    let base = base_dir();
    let mut out = Vec::new();
    adfs_in(&base, &mut out);
    let mut subs: Vec<PathBuf> = std::fs::read_dir(&base)
        .map(|rd| {
            rd.flatten()
                .map(|e| e.path())
                .filter(|p| p.is_dir() && p.file_name().map(|n| n.to_string_lossy() != DATA_DIR).unwrap_or(true))
                .collect()
        })
        .unwrap_or_default();
    subs.sort();
    let top = out.len();
    out[..top].sort();
    for d in subs {
        let mut found = Vec::new();
        adfs_in(&d, &mut found);
        found.sort();
        out.extend(found);
    }
    out
}

/// the bytes of one of the files list_adfs returned (only files under the exe's folder)
#[tauri::command]
fn read_adf(path: String) -> Result<tauri::ipc::Response, String> {
    let base = base_dir().canonicalize().map_err(|e| e.to_string())?;
    let p = PathBuf::from(&path).canonicalize().map_err(|e| e.to_string())?;
    if !p.starts_with(&base) {
        return Err("not in the game's folder".into());
    }
    let bytes = std::fs::read(&p).map_err(|e| e.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![list_adfs, read_adf])
        .setup(|app| {
            let dir = base_dir().join(DATA_DIR);
            WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Giganoid 3D")
                .inner_size(1300.0, 920.0)
                .center()
                .resizable(true)
                .disable_drag_drop_handler()
                .data_directory(dir)
                // Tauri's default WebView2 flags, plus a tiny HTTP cache so the data folder stays small
                .additional_browser_args("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --disk-cache-size=1048576")
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Giganoid 3D");
}
