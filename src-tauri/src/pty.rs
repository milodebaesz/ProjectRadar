//! Ingebouwde terminal: PTY-sessies via `portable-pty`. Output streamt naar de
//! frontend via een Tauri-Channel; invoer/resize/kill via commands.

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter, State};

struct PtySession {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
pub struct PtyState {
    sessions: Arc<Mutex<HashMap<u64, PtySession>>>,
    next: AtomicU64,
}

/// Standaard-shell van de gebruiker (val terug op zsh).
fn user_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string())
}

/// Start een interactieve login-shell in `cwd`. Output stroomt via `on_data`;
/// geeft een sessie-id terug voor write/resize/kill.
#[tauri::command]
pub fn pty_spawn(
    state: State<'_, PtyState>,
    app: AppHandle,
    on_data: Channel<Vec<u8>>,
    cwd: String,
    cols: u16,
    rows: u16,
) -> Result<u64, String> {
    let sys = native_pty_system();
    let pair = sys
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("PTY openen mislukt: {e}"))?;

    let mut cmd = CommandBuilder::new(user_shell());
    cmd.arg("-l"); // login-shell zodat PATH (claude, npm, …) klopt
    // Lege cwd → home-map.
    let dir = if cwd.trim().is_empty() {
        std::env::var("HOME").unwrap_or_else(|_| ".".to_string())
    } else {
        cwd
    };
    cmd.cwd(dir);
    cmd.env("TERM", "xterm-256color");

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Shell starten mislukt: {e}"))?;
    drop(pair.slave); // sluit slave zodat EOF komt als de shell stopt

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Reader mislukt: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Writer mislukt: {e}"))?;

    let id = state.next.fetch_add(1, Ordering::SeqCst);

    state.sessions.lock().unwrap().insert(
        id,
        PtySession {
            writer,
            master: pair.master,
            child,
        },
    );

    // Leesthread: stream output tot EOF, ruim daarna op en meld exit.
    let sessions = state.sessions.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    if on_data.send(buf[..n].to_vec()).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        sessions.lock().unwrap().remove(&id);
        let _ = app.emit("pty-exit", id);
    });

    Ok(id)
}

/// Schrijf invoer (toetsaanslagen of een ingespoten commando) naar de PTY.
#[tauri::command]
pub fn pty_write(state: State<'_, PtyState>, id: u64, data: String) -> Result<(), String> {
    let mut map = state.sessions.lock().unwrap();
    let s = map.get_mut(&id).ok_or("Onbekende terminal")?;
    s.writer
        .write_all(data.as_bytes())
        .map_err(|e| format!("Schrijven mislukt: {e}"))?;
    s.writer.flush().ok();
    Ok(())
}

/// Pas de PTY-grootte aan (kolommen/rijen) na een venster/paneel-resize.
#[tauri::command]
pub fn pty_resize(state: State<'_, PtyState>, id: u64, cols: u16, rows: u16) -> Result<(), String> {
    let map = state.sessions.lock().unwrap();
    if let Some(s) = map.get(&id) {
        s.master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Resize mislukt: {e}"))?;
    }
    Ok(())
}

/// Beëindig een terminalsessie (bij het sluiten van een tab of de app).
#[tauri::command]
pub fn pty_kill(state: State<'_, PtyState>, id: u64) -> Result<(), String> {
    if let Some(mut s) = state.sessions.lock().unwrap().remove(&id) {
        let _ = s.child.kill();
    }
    Ok(())
}
