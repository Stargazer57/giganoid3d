// Giganoid 3D as a desktop app: a native window running the game in the system WebView2 engine.
// Everything the game saves (settings, level disks, custom sounds) lives in a folder next to the exe.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{WebviewUrl, WebviewWindowBuilder};

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let exe = std::env::current_exe()?;
            let dir = exe.parent().map(|p| p.to_path_buf()).unwrap_or_default().join("Giganoid3D-data");
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
