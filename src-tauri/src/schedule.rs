//! Autonome planner voor geplande sprint-starts (`Phase.scheduledAt`).
//!
//! Draait als een OS-thread in het hoofdproces — niet in de webview. Dat is
//! bewust: macOS behandelt een vergrendeld scherm als een occluded venster, en
//! WKWebView throttlet JS-timers (zoals de vorige `setInterval`-implementatie
//! in `useScheduledRuns.ts`) zodra het venster niet zichtbaar is. Deze thread
//! leeft buiten de webview en loopt gewoon door, ook als het scherm op slot zit.
//!
//! De frontend blijft eigenaar van de roadmap-data; hij duwt een compacte
//! snapshot van elke geplande fase hierheen (`schedule_set`) en haalt bij elke
//! poll op wat er inmiddels is afgevuurd (`take_fired_schedules`), zodat de
//! geschiedenis/toast alsnog verschijnt zodra de gebruiker terug is.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleEntry {
    pub id: String,
    pub project_key: String,
    pub project_path: String,
    pub phase_name: String,
    pub milestones: Vec<String>,
    /// Epoch-milliseconden — vermijdt datum-parsing in Rust.
    pub scheduled_at_ms: i64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FiredEntry {
    pub id: String,
    pub project_key: String,
    pub phase_name: String,
    pub fired_at_ms: i64,
    pub log_path: String,
}

fn base_dir() -> Result<PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME niet gevonden".to_string())?;
    let dir = PathBuf::from(home).join(".projectradar");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Map aanmaken mislukt: {e}"))?;
    Ok(dir)
}

fn store_path() -> Result<PathBuf, String> {
    Ok(base_dir()?.join("schedules.json"))
}

fn fired_path() -> Result<PathBuf, String> {
    Ok(base_dir()?.join("scheduled-fired.json"))
}

fn read_json<T: for<'de> Deserialize<'de> + Default>(path: &PathBuf) -> T {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn write_json<T: Serialize>(path: &PathBuf, value: &T) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    std::fs::write(path, raw).map_err(|e| format!("Schrijven mislukt: {e}"))
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Plan een sprint-start in (of werk 'm bij) — overschrijft een bestaande entry
/// met hetzelfde id.
pub fn schedule_set(entry: ScheduleEntry) -> Result<(), String> {
    let path = store_path()?;
    let mut all: Vec<ScheduleEntry> = read_json(&path);
    all.retain(|e| e.id != entry.id);
    all.push(entry);
    write_json(&path, &all)
}

/// Haal een geplande start weer weg (handmatig geannuleerd, of fase/mijlpaal
/// verwijderd).
pub fn schedule_clear(id: String) -> Result<(), String> {
    let path = store_path()?;
    let mut all: Vec<ScheduleEntry> = read_json(&path);
    all.retain(|e| e.id != id);
    write_json(&path, &all)
}

/// Haal alle nog niet door de UI verwerkte "is afgevuurd"-meldingen op en wis
/// de queue meteen — zo ziet de frontend elke fire precies één keer, ongeacht
/// hoe lang de app dicht of het scherm vergrendeld was.
pub fn take_fired_schedules() -> Vec<FiredEntry> {
    let path = match fired_path() {
        Ok(p) => p,
        Err(_) => return Vec::new(),
    };
    let all: Vec<FiredEntry> = read_json(&path);
    let _ = std::fs::remove_file(&path);
    all
}

fn append_fired(entry: FiredEntry) {
    if let Ok(path) = fired_path() {
        let mut all: Vec<FiredEntry> = read_json(&path);
        all.push(entry);
        let _ = write_json(&path, &all);
    }
}

/// Lees het logbestand van een autonome run terug (voor "wat is er gebeurd
/// terwijl ik weg was").
pub fn read_log_file(path: String) -> Result<String, String> {
    // Alleen logs uit ~/.projectradar. Zonder deze grens is dit een
    // algemene "lees elk bestand"-opdracht voor de webview, terwijl er niets
    // buiten die map te lezen valt. Canonicaliseren eerst, anders komt een
    // pad met .. er alsnog uit.
    let base = base_dir()?;
    let full = std::fs::canonicalize(&path).map_err(|e| format!("Lezen mislukt: {e}"))?;
    let root = std::fs::canonicalize(&base).unwrap_or(base);
    if !full.starts_with(&root) {
        return Err("Buiten de Projectradar-map — niet gelezen.".into());
    }
    std::fs::read_to_string(&full).map_err(|e| format!("Lezen mislukt: {e}"))
}

/// Zelfde opbouw als `buildPhasePrompt` in `model.ts` — moet in sync blijven.
fn build_phase_prompt(phase_name: &str, milestones: &[String]) -> String {
    let mut lines = vec![
        "Pak de draad op. Werk de volgende sprint volledig uit:".to_string(),
        String::new(),
        format!("Fase: {phase_name}"),
        "Openstaande mijlpalen:".to_string(),
    ];
    for m in milestones {
        lines.push(format!("- {m}"));
    }
    lines.push(String::new());
    lines.push(
        "Analyseer de huidige stand van de code en implementeer deze mijlpalen één voor één."
            .to_string(),
    );
    lines.push(
        "Vink elke mijlpaal af in `.projectradar.json` (zet `\"done\": true`) zodra hij klaar is."
            .to_string(),
    );
    lines.join("\n")
}

fn fire(entry: ScheduleEntry, app: &AppHandle) {
    let prompt = build_phase_prompt(&entry.phase_name, &entry.milestones);
    let line = match crate::git::claude_shell_line(entry.project_path.clone(), prompt) {
        Ok(l) => l,
        Err(_) => return,
    };
    let ts = now_ms();
    let log_path = match base_dir() {
        Ok(d) => d.join("claude").join(format!("scheduled-{ts}.log")),
        Err(_) => return,
    };
    if let Some(parent) = log_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    crate::pty::spawn_detached(entry.project_path.clone(), line, log_path.clone());
    append_fired(FiredEntry {
        id: entry.id.clone(),
        project_key: entry.project_key.clone(),
        phase_name: entry.phase_name.clone(),
        fired_at_ms: ts,
        log_path: log_path.to_string_lossy().to_string(),
    });
    let _ = app.emit("scheduled-fired", ());
}

/// Achtergrondtaak: elke 20s de opgeslagen schedules checken en afvuren zodra
/// de tijd verstreken is. Draait als OS-thread in het hoofdproces, dus
/// onafhankelijk van de webview — blijft ook lopen als het venster
/// vergrendeld/occluded is.
pub fn start(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(20));
        let path = match store_path() {
            Ok(p) => p,
            Err(_) => continue,
        };
        let all: Vec<ScheduleEntry> = read_json(&path);
        if all.is_empty() {
            continue;
        }
        let now = now_ms();
        let (due, rest): (Vec<_>, Vec<_>) = all.into_iter().partition(|e| e.scheduled_at_ms <= now);
        if due.is_empty() {
            continue;
        }
        let _ = write_json(&path, &rest);
        for entry in due {
            fire(entry, &app);
        }
    });
}
