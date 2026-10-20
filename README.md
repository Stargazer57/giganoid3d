# Giganoid 3D (desktop app)

The Giganoid 3D remake packaged as a Windows app with [Tauri](https://tauri.app): one exe, its own 1300x920 window,
no browser and no local server. It runs on WebView2, the Edge engine built into Windows 10/11.

**Download:** the latest exe is on the [Releases page](../../releases/tag/latest).

Settings, loaded level disks and custom sounds are saved in a `Giganoid3D-data` folder next to the exe.

Every push to `main` rebuilds the exe on GitHub Actions (`.github/workflows/build.yml`).
The game itself is `dist/index.html`.
