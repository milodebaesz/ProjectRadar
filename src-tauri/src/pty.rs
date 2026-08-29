//! Ingebouwde terminal: PTY-sessies via `portable-pty`. Output streamt naar de
//! frontend via een Tauri-Channel; invoer/resize/kill via commands.

use portable_pty::{native_pty_system, Child, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
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

/// Start een PTY-sessie zonder frontend-Channel — puur voor autonome
/// (geplande) runs. Output gaat alleen naar `log_path`, niet naar de UI: de
/// sessie draait volledig los van of ProjectRadar open/zichtbaar is. Fouten
/// worden stil genegeerd (er is niemand om ze aan te melden); een mislukte
/// spawn betekent gewoon dat de geplande run niet zichtbaar wordt.
pub fn spawn_detached(cwd: String, initial_command: String, log_path: std::path::PathBuf) {
    let sys = native_pty_system();
    let pair = match sys.openpty(PtySize {
        rows: 40,
        cols: 120,
        pixel_width: 0,
        pixel_height: 0,
    }) {
        Ok(p) => p,
        Err(_) => return,
    };

    let mut cmd = CommandBuilder::new(user_shell());
    cmd.arg("-l");
    cmd.cwd(cwd);
    cmd.env("TERM", "xterm-256color");

    let child = match pair.slave.spawn_command(cmd) {
        Ok(c) => c,
        Err(_) => return,
    };
    drop(pair.slave);

    let reader = pair.master.try_clone_reader();
    let writer = pair.master.take_writer();
    let (mut reader, mut writer) = match (reader, writer) {
        (Ok(r), Ok(w)) => (r, w),
        _ => return,
    };
    let _ = writeln!(writer, "{initial_command}");
    drop(writer);

    let master = pair.master;
    let mut child = child;
    std::thread::spawn(move || {
        let _keep_master_alive = master;
        let mut file = match std::fs::File::create(&log_path) {
            Ok(f) => f,
            Err(_) => return,
        };
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let _ = file.write_all(&buf[..n]);
                }
                Err(_) => break,
            }
        }
        let _ = child.wait();
    });
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

// ── Managed sessies: gestart vanuit Rust (nachtelijke prompt-runner), niet ──
// vanuit de webview. Anders dan `pty_spawn` (streamt live naar een Channel —
// vereist een luisterende webview) en `spawn_detached` (schrijft stil naar een
// logbestand — nooit zichtbaar in de UI), buffert dit type de output in het
// geheugen. De terminal-dock leest 'm uit zodra hij weer actief is, ook als
// hij dat niet was op het moment dat de sessie startte (vergrendeld scherm).

const MAX_MANAGED_OUTPUT: usize = 1_000_000;

/// Vast PTY-formaat voor managed sessies. `MANAGED_COLS` moet in sync blijven
/// met `TerminalDock.tsx` (managed-tak): die fit bewust niet op de breedte en
/// stuurt geen `ptyResize` terug, want er is niemand om een live-resize aan
/// door te geven aan een sessie die al liep vóór er een webview was. Wijken
/// de kolommen af, dan schrijft Claude regelafbrekingen en cursorkolommen
/// uitgaand van dít formaat terwijl de viewer ze op een ander interpreteert —
/// dat ziet eruit als door elkaar lopende tekst.
///
/// `MANAGED_ROWS` is alleen de starthoogte van de PTY. De viewer fit zijn
/// hoogte wél op het paneel: hield hij die vast op 32 rijen, dan werd het
/// terminal-element hoger dan de dock, nam de omliggende container het
/// verticaal scrollen over en was xterm's scrollback onbereikbaar — je kon
/// dan niet terugkijken in een nachtelijke run. Rijen mogen afwijken; wat
/// bovenaan uit beeld loopt bewaart xterm in zijn scrollback.
pub const MANAGED_COLS: u16 = 100;
pub const MANAGED_ROWS: u16 = 32;

#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ManagedStatus {
    Running,
    Done,
    Failed,
}

pub struct ManagedSession {
    pub project_key: String,
    pub title: String,
    pub output: Vec<u8>,
    pub status: ManagedStatus,
}

/// `Clone`baar en toch één gedeelde identiteit: beide velden zijn `Arc`, dus
/// elke kloon (Tauri-managed state, de nachtelijke achtergrondthread, een
/// handmatige "Nu uitvoeren"-aanroep) wijst naar dezelfde sessies + dezelfde
/// id-teller. Zonder dat zou elke kloon zijn eigen teller bij 0 beginnen en
/// zouden sessie-id's kunnen botsen.
#[derive(Default, Clone)]
pub struct ManagedState {
    pub sessions: Arc<Mutex<HashMap<u64, ManagedSession>>>,
    next: Arc<AtomicU64>,
}

/// Start een managed sessie. Geeft het sessie-id terug, een receiver die
/// `true`/`false` (Claude's eigen exit-code, zie
/// `claude_shell_line_capture_exit`) levert zodra het **proces** stopt, en een
/// killer om de sessie desnoods af te breken.
///
/// De aanroeper (de nachtelijke runner) wacht op die receiver voor hij de
/// volgende prompt start — dat is wat "strikt na elkaar" concreet betekent.
/// Juist daarom mag dat signaal nooit uitblijven: doet het dat wel, dan staat
/// de hele nacht stil na de eerste prompt.
///
/// Vandaar dat het uit een aparte wacht-thread komt die alleen `child.wait()`
/// doet, en niet uit de leeslus. Die leeslus eindigt pas bij EOF op de PTY, en
/// EOF komt er pas als élke fd op de slave dicht is — één achtergebleven
/// kleinkind (een MCP-server, een ge-`&`-de osascript uit de status-hook) houdt
/// die open en dan lag de batch stil terwijl Claude allang klaar was.
pub fn spawn_managed(
    state: &ManagedState,
    cwd: String,
    initial_command: String,
    project_key: String,
    title: String,
) -> (u64, mpsc::Receiver<bool>, Option<Box<dyn ChildKiller + Send + Sync>>) {
    let id = state.next.fetch_add(1, Ordering::SeqCst);
    state.sessions.lock().unwrap().insert(
        id,
        ManagedSession { project_key, title, output: Vec::new(), status: ManagedStatus::Running },
    );

    let (tx, rx) = mpsc::channel();
    let sessions = state.sessions.clone();

    let fail = |sessions: &Arc<Mutex<HashMap<u64, ManagedSession>>>, tx: mpsc::Sender<bool>| {
        if let Some(s) = sessions.lock().unwrap().get_mut(&id) {
            s.status = ManagedStatus::Failed;
        }
        let _ = tx.send(false);
    };

    let sys = native_pty_system();
    let pair = match sys.openpty(PtySize { rows: MANAGED_ROWS, cols: MANAGED_COLS, pixel_width: 0, pixel_height: 0 }) {
        Ok(p) => p,
        Err(_) => { fail(&sessions, tx); return (id, rx, None); }
    };
    let mut cmd = CommandBuilder::new(user_shell());
    cmd.arg("-l");
    cmd.cwd(cwd);
    cmd.env("TERM", "xterm-256color");
    let child = match pair.slave.spawn_command(cmd) {
        Ok(c) => c,
        Err(_) => { fail(&sessions, tx); return (id, rx, None); }
    };
    drop(pair.slave);
    // Vóór het verplaatsen naar de wacht-thread: hiermee kan de aanroeper een
    // vastgelopen sessie alsnog afbreken.
    let killer = child.clone_killer();

    let reader = pair.master.try_clone_reader();
    let writer = pair.master.take_writer();
    let (mut reader, mut writer) = match (reader, writer) {
        (Ok(r), Ok(w)) => (r, w),
        _ => { fail(&sessions, tx); return (id, rx, None); }
    };
    let _ = writeln!(writer, "{initial_command}");
    drop(writer);

    let master = pair.master;
    let mut child = child;

    // Leeslus: verzamelt output tot de PTY dichtgaat. Mag gerust langer leven
    // dan het proces zelf — hij bepaalt niet meer wanneer de sessie klaar is.
    let reader_sessions = sessions.clone();
    std::thread::spawn(move || {
        let _keep_master_alive = master;
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    if let Some(s) = reader_sessions.lock().unwrap().get_mut(&id) {
                        s.output.extend_from_slice(&buf[..n]);
                        // Cap geheugen: bewaar het einde — daar staat meestal de fout.
                        if s.output.len() > MAX_MANAGED_OUTPUT {
                            let excess = s.output.len() - MAX_MANAGED_OUTPUT;
                            s.output.drain(0..excess);
                        }
                    }
                }
                Err(_) => break,
            }
        }
    });

    // Wacht-thread: dit is wat "klaar" betekent. Puur het proces, los van of
    // de PTY al EOF gaf.
    std::thread::spawn(move || {
        let ok = child.wait().map(|status| status.success()).unwrap_or(false);
        if let Some(s) = sessions.lock().unwrap().get_mut(&id) {
            s.status = if ok { ManagedStatus::Done } else { ManagedStatus::Failed };
        }
        let _ = tx.send(ok);
    });

    (id, rx, Some(killer))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    /// Regressie: de nachtrun pakte alleen de eerste van zes prompts op.
    ///
    /// Oorzaak: "klaar" werd afgeleid uit EOF op de PTY, en EOF komt er pas
    /// als élke fd op de slave dicht is. Eén achtergebleven achtergrondproces
    /// houdt die open, waardoor het signaal nooit kwam en de runner voor
    /// altijd op prompt 1 bleef wachten. Nu komt het uit `child.wait()`.
    #[test]
    fn meldt_klaar_ook_als_een_achtergrondproces_de_pty_openhoudt() {
        let state = ManagedState::default();
        // De shell start een slaper die de PTY vasthoudt en sluit zelf af.
        let (_id, rx, _killer) = spawn_managed(
            &state,
            "/tmp".to_string(),
            "sleep 30 & exit 0".to_string(),
            "test".to_string(),
            "test".to_string(),
        );
        let uitkomst = rx.recv_timeout(Duration::from_secs(10));
        assert!(
            uitkomst.is_ok(),
            "geen voltooiingssignaal binnen 10s terwijl de shell allang klaar was"
        );
    }

    /// De exit-code van de shell bepaalt geslaagd/mislukt — daar hangt in
    /// `nightly.rs` aan of een prompt op done of failed gezet wordt.
    #[test]
    fn geeft_de_exit_code_door() {
        let state = ManagedState::default();
        let (_id, ok_rx, _k1) = spawn_managed(
            &state, "/tmp".to_string(), "exit 0".to_string(), "t".into(), "t".into(),
        );
        assert_eq!(ok_rx.recv_timeout(Duration::from_secs(10)).unwrap(), true);

        let (_id2, fail_rx, _k2) = spawn_managed(
            &state, "/tmp".to_string(), "exit 3".to_string(), "t".into(), "t".into(),
        );
        assert_eq!(fail_rx.recv_timeout(Duration::from_secs(10)).unwrap(), false);
    }
    /// Bewijs dat de test hierboven de bug zou vangen: het signaal moet komen
    /// zodra de shell klaar is, niet pas als de achtergrondslaper de PTY
    /// loslaat. Onder de oude opzet (klaar = EOF) had dit ~30s geduurd.
    #[test]
    fn signaal_komt_bij_shell_exit_niet_bij_pty_eof() {
        let state = ManagedState::default();
        let start = std::time::Instant::now();
        let (_id, rx, _k) = spawn_managed(
            &state, "/tmp".to_string(), "sleep 30 & exit 0".to_string(), "t".into(), "t".into(),
        );
        rx.recv_timeout(Duration::from_secs(10)).expect("geen signaal");
        let verstreken = start.elapsed();
        assert!(
            verstreken < Duration::from_secs(3),
            "signaal kwam pas na {verstreken:?} — dat wijst op wachten op PTY-EOF"
        );
    }
}
