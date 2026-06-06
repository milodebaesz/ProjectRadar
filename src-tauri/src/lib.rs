mod git;
mod pty;

use serde::Serialize;

#[derive(Serialize)]
pub struct MachineInfo {
    /// Hostnaam van deze PC, bruikbaar als standaardlabel.
    hostname: String,
    os: String,
}

#[tauri::command]
fn machine_info() -> MachineInfo {
    MachineInfo {
        hostname: gethostname::gethostname().to_string_lossy().to_string(),
        os: std::env::consts::OS.to_string(),
    }
}

#[tauri::command]
fn scan_roots(roots: Vec<String>) -> git::ScanResult {
    git::scan_roots(roots)
}

#[tauri::command]
fn git_init(path: String) -> Result<(), String> {
    git::git_init(path)
}

#[tauri::command]
fn claude_shell_line(path: String, prompt: String) -> Result<String, String> {
    git::claude_shell_line(path, prompt)
}

#[tauri::command]
fn claude_status() -> Vec<git::ClaudeStatus> {
    git::claude_status()
}

#[tauri::command]
fn trash_path(path: String) -> Result<(), String> {
    git::trash_path(path)
}

#[tauri::command]
async fn check_port(port: u16) -> bool {
    // Op een blocking-thread zodat de TCP-timeout de UI niet ophoudt.
    tauri::async_runtime::spawn_blocking(move || git::check_port(port))
        .await
        .unwrap_or(false)
}

#[tauri::command]
fn open_browser(url: String) -> Result<(), String> {
    git::open_browser(url)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(pty::PtyState::default())
        .invoke_handler(tauri::generate_handler![
            machine_info,
            scan_roots,
            git_init,
            claude_shell_line,
            claude_status,
            trash_path,
            check_port,
            open_browser,
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
