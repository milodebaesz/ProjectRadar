mod git;
mod nightly;
mod pty;
mod remote;
mod schedule;
mod secrets;

use serde::Serialize;
use tauri::Manager;

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

#[tauri::command]
fn secret_set(account: String, value: String) -> Result<(), String> {
    secrets::secret_set(account, value)
}

#[tauri::command]
fn secret_get(account: String) -> Option<String> {
    secrets::secret_get(account)
}

#[tauri::command]
fn secret_delete(account: String) -> Result<(), String> {
    secrets::secret_delete(account)
}

#[tauri::command]
fn schedule_set(entry: schedule::ScheduleEntry) -> Result<(), String> {
    schedule::schedule_set(entry)
}

#[tauri::command]
fn schedule_clear(id: String) -> Result<(), String> {
    schedule::schedule_clear(id)
}

#[tauri::command]
fn take_fired_schedules() -> Vec<schedule::FiredEntry> {
    schedule::take_fired_schedules()
}

#[tauri::command]
fn read_log_file(path: String) -> Result<String, String> {
    schedule::read_log_file(path)
}

#[tauri::command]
fn remote_info() -> remote::RemoteInfo {
    remote::info()
}

#[tauri::command]
fn push_remote_state(state: tauri::State<'_, remote::RemoteStateHandle>, value: serde_json::Value) {
    *state.0.lock().unwrap() = Some(value);
}

#[tauri::command]
fn remote_token_get() -> String {
    remote::ensure_token()
}

#[tauri::command]
fn remote_token_regenerate() -> String {
    remote::regenerate_token()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(pty::PtyState::default())
        .manage(pty::ManagedState::default())
        .manage(nightly::ProjectPaths::default())
        .manage(remote::RemoteStateHandle::default())
        .setup(|app| {
            // Achtergrondplanner voor geplande sprint-starts: draait als OS-thread
            // in het hoofdproces, dus onafhankelijk van de webview (blijft ook
            // lopen terwijl het scherm vergrendeld is).
            schedule::start(app.handle().clone());
            // Externe (Tailscale) bediening: start alleen als er een
            // Tailscale-IP gevonden wordt, zie remote.rs.
            let remote_state = app.state::<remote::RemoteStateHandle>().0.clone();
            remote::start(app.handle().clone(), remote_state);
            // Nachtelijke prompt-runner (PromptPad): zelfde reden als de
            // sprint-scheduler om als OS-thread te draaien, zie nightly.rs.
            let managed_state = app.state::<pty::ManagedState>().inner().clone();
            let project_paths = app.state::<nightly::ProjectPaths>().0.clone();
            nightly::start(app.handle().clone(), managed_state, project_paths);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            machine_info,
            scan_roots,
            git_init,
            git::read_radar_file,
            claude_shell_line,
            claude_status,
            trash_path,
            check_port,
            open_browser,
            secret_set,
            secret_get,
            secret_delete,
            schedule_set,
            schedule_clear,
            take_fired_schedules,
            read_log_file,
            remote_info,
            push_remote_state,
            remote_token_get,
            remote_token_regenerate,
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            nightly::nightly_config_set,
            nightly::nightly_config_get,
            nightly::nightly_config_clear,
            nightly::push_project_paths,
            nightly::nightly_sessions,
            nightly::nightly_read,
            nightly::nightly_run_now,
            nightly::nightly_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
