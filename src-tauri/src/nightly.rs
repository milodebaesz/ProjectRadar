//! Nachtelijke prompt-runner: haalt elke nacht om 3 uur "pending" prompts op
//! uit de PromptPad-Supabase-tabel `pp_prompts`, matcht ze op projectnaam
//! tegen wat er lokaal gescand is, en voert ze strikt na elkaar uit via
//! Claude Code — ook over projecten heen. (Eerst per project parallel; dat
//! liet meerdere `claude`-processen tegelijk concurreren om CPU/geheugen en
//! liep in de praktijk vast, zie `run_batch`.)
//!
//! Draait als OS-thread (zie `schedule.rs` voor de reden): een vergrendeld
//! scherm laat macOS het venster als "occluded" behandelen, wat JS in de
//! webview throttlet. `caffeinate` voorkomt dat de Mac in slaap valt, maar
//! niet die throttling — de aandrijving moet dus hier zitten, niet in React.
//!
//! De sessies zelf draaien via `pty::spawn_managed`, die de output in het
//! geheugen buffert. De webview (terminal-dock) leest die buffer uit zodra
//! hij weer actief is — hij drijft de run niet aan, hij toont 'm alleen.

use crate::pty::{spawn_managed, ManagedState, ManagedStatus};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

const SUPABASE_URL_ACCOUNT: &str = "nightly-supabase-url";
const SUPABASE_KEY_ACCOUNT: &str = "nightly-supabase-key";
const LAST_RUN_ACCOUNT: &str = "nightly-last-run-date";
/// Venster waarin de nachtrun mag (na)vuren, lokale tijd. Vangt op dat de Mac
/// pas na 03:00 wakker wordt (caffeinate ten spijt); na dit venster wachten
/// we tot de volgende nacht i.p.v. een gemiste run uren later alsnog te doen.
const FIRE_HOUR_START: u32 = 3;
const FIRE_HOUR_END: u32 = 6;

// ── Blijvende status ─────────────────────────────────────────────────────
//
// De eprintln!'s hierboven zijn nuttig terwijl je meekijkt, maar verdwijnen
// zodra de terminal dicht is — waardoor achteraf niet meer te zien is of de
// achtergrondlus vannacht überhaupt draaide, laat staan wat 'm tegenhield.
// Dit bestand overleeft dat: één klein JSON-bestand, overschreven (niet
// aangevuld) bij elke tick en elke run, zodat Instellingen altijd kan tonen
// "voor het laatst actief X geleden" en "laatste run: ... — <samenvatting>".

fn status_path() -> Option<PathBuf> {
    let home = std::env::var("HOME").ok()?;
    Some(PathBuf::from(home).join(".projectradar").join("nightly-status.json"))
}

#[derive(Serialize, Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NightlyStatus {
    /// Laatste keer dat de achtergrondlus een tick deed — bewijst dat de
    /// thread leeft, los van of er iets te doen was.
    pub last_tick_at: Option<String>,
    pub last_fire_at: Option<String>,
    pub last_fire_summary: Option<String>,
}

fn read_status() -> NightlyStatus {
    status_path()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

fn write_status(status: &NightlyStatus) {
    let Some(path) = status_path() else { return };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(raw) = serde_json::to_string_pretty(status) {
        let _ = std::fs::write(path, raw);
    }
}

fn touch_tick() {
    let mut s = read_status();
    s.last_tick_at = Some(chrono::Local::now().to_rfc3339());
    write_status(&s);
}

fn record_fire(summary: String) {
    let mut s = read_status();
    s.last_fire_at = Some(chrono::Local::now().to_rfc3339());
    s.last_fire_summary = Some(summary);
    write_status(&s);
}

#[tauri::command]
pub fn nightly_status() -> NightlyStatus {
    read_status()
}

/// key -> lokaal pad, gepusht door de frontend na elke scan. Alleen projecten
/// die hier in staan hebben op déze Mac een map om Claude in te starten.
#[derive(Default)]
pub struct ProjectPaths(pub Arc<Mutex<HashMap<String, String>>>);

#[tauri::command]
pub fn nightly_config_set(url: String, key: String) -> Result<(), String> {
    crate::secrets::secret_set(SUPABASE_URL_ACCOUNT.to_string(), url)?;
    crate::secrets::secret_set(SUPABASE_KEY_ACCOUNT.to_string(), key)
}

/// Geeft alleen de URL terug (om in Instellingen te tonen); de sleutel blijft
/// in de keychain en gaat nooit terug naar de webview.
#[tauri::command]
pub fn nightly_config_get() -> Option<String> {
    crate::secrets::secret_get(SUPABASE_URL_ACCOUNT.to_string()).filter(|u| !u.is_empty())
}

#[tauri::command]
pub fn nightly_config_clear() -> Result<(), String> {
    let _ = crate::secrets::secret_delete(SUPABASE_URL_ACCOUNT.to_string());
    crate::secrets::secret_delete(SUPABASE_KEY_ACCOUNT.to_string())
}

#[tauri::command]
pub fn push_project_paths(state: State<'_, ProjectPaths>, paths: Vec<(String, String)>) {
    *state.0.lock().unwrap() = paths.into_iter().collect();
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NightlySessionInfo {
    pub id: u64,
    pub project_key: String,
    pub title: String,
    pub status: ManagedStatus,
}

#[tauri::command]
pub fn nightly_sessions(state: State<'_, ManagedState>) -> Vec<NightlySessionInfo> {
    state
        .sessions
        .lock()
        .unwrap()
        .iter()
        .map(|(id, s)| NightlySessionInfo {
            id: *id,
            project_key: s.project_key.clone(),
            title: s.title.clone(),
            status: s.status,
        })
        .collect()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NightlyReadResult {
    pub chunk: String,
    pub next_offset: usize,
    pub status: ManagedStatus,
}

/// Leest nieuwe output sinds `since` (bytes) terug. De frontend pollt dit
/// zoals hij ook `claude_status` pollt, en onthoudt zelf de laatste offset.
#[tauri::command]
pub fn nightly_read(state: State<'_, ManagedState>, id: u64, since: usize) -> NightlyReadResult {
    let map = state.sessions.lock().unwrap();
    match map.get(&id) {
        Some(s) => {
            let slice = if since < s.output.len() { &s.output[since..] } else { &[] };
            NightlyReadResult {
                chunk: String::from_utf8_lossy(slice).to_string(),
                next_offset: s.output.len(),
                status: s.status,
            }
        }
        None => NightlyReadResult { chunk: String::new(), next_offset: since, status: ManagedStatus::Failed },
    }
}

/// Handmatige trigger ("Nu uitvoeren" in Instellingen) — negeert het
/// tijdvenster en de "vandaag al gedraaid"-markering, zodat je de opzet kunt
/// testen zonder tot 3 uur te wachten.
#[tauri::command]
pub fn nightly_run_now(app: AppHandle, managed: State<'_, ManagedState>, paths: State<'_, ProjectPaths>) {
    let managed = managed.inner().clone();
    let paths = paths.0.clone();
    std::thread::spawn(move || run_batch(&app, managed, paths));
}

// ── Supabase (PromptPad) ────────────────────────────────────────────────────

#[derive(Deserialize)]
struct ProjectRef {
    name: String,
}

#[derive(Deserialize)]
struct PromptRow {
    id: String,
    title: String,
    body: String,
    // PostgREST embedt de FK-relatie als object; kan ontbreken als het
    // project inmiddels verwijderd is.
    #[serde(default)]
    pp_projects: Option<ProjectRef>,
}

fn headers(req: reqwest::blocking::RequestBuilder, key: &str) -> reqwest::blocking::RequestBuilder {
    req.header("apikey", key).header("Authorization", format!("Bearer {key}"))
}

fn fetch_pending(client: &reqwest::blocking::Client, base: &str, key: &str) -> Result<Vec<PromptRow>, String> {
    let url = format!(
        "{}/rest/v1/pp_prompts?status=eq.pending&select=id,title,body,pp_projects(name)&order=created_at.asc",
        base.trim_end_matches('/')
    );
    let resp = headers(client.get(&url), key)
        .send()
        .map_err(|e| format!("Ophalen bij Supabase mislukt: {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        // PostgREST zet de échte reden (bijv. een ontbrekende kolom) in de
        // response-body, niet in de statuscode — zonder die mee te lezen is
        // "400 Bad Request" niet te diagnosticeren.
        let body = resp.text().unwrap_or_default();
        return Err(format!("Supabase antwoordde met {status}: {body}"));
    }
    resp.json().map_err(|e| format!("Onverwacht antwoord van Supabase: {e}"))
}

/// Claimt één prompt atomisch (`status=eq.pending` in de filter, niet alleen
/// in de body) zodat een handmatige "Nu uitvoeren" en de nachtrun elkaars
/// prompts nooit dubbel oppakken. `false` betekent: iemand anders was net
/// eerder, of de patch mislukte — in beide gevallen niet uitvoeren.
fn claim(client: &reqwest::blocking::Client, base: &str, key: &str, id: &str) -> bool {
    let url = format!(
        "{}/rest/v1/pp_prompts?id=eq.{id}&status=eq.pending",
        base.trim_end_matches('/')
    );
    let body = serde_json::json!({ "status": "running", "started_at": chrono::Utc::now().to_rfc3339() });
    let resp = headers(client.patch(&url), key)
        .header("Prefer", "return=representation")
        .json(&body)
        .send();
    match resp {
        Ok(r) if r.status().is_success() => {
            r.json::<Vec<serde_json::Value>>().map(|v| !v.is_empty()).unwrap_or(false)
        }
        _ => false,
    }
}

/// Zet het eindresultaat terug. `tail` (laatste stuk output) gaat alleen mee
/// als `error`-context bij een mislukking — bij succes blijft dat veld leeg.
fn finish(client: &reqwest::blocking::Client, base: &str, key: &str, id: &str, ok: bool, tail: &str) {
    let body = serde_json::json!({
        "status": if ok { "done" } else { "failed" },
        "finished_at": chrono::Utc::now().to_rfc3339(),
        "error": if ok { serde_json::Value::Null } else { serde_json::Value::String(tail.to_string()) },
    });
    let url = format!("{}/rest/v1/pp_prompts?id=eq.{id}", base.trim_end_matches('/'));
    let _ = headers(client.patch(&url), key).json(&body).send();
}

/// Markeert één prompt als mislukt zonder 'm te starten — voor een prompt
/// waarvan het project op déze Mac niet gevonden kon worden. Zonder dit zou
/// hij eindeloos `pending` blijven en elke nacht opnieuw geprobeerd worden.
fn fail_unmatched(client: &reqwest::blocking::Client, base: &str, key: &str, prompt: &PromptRow, reason: &str) {
    if claim(client, base, key, &prompt.id) {
        finish(client, base, key, &prompt.id, false, reason);
    }
}

fn last_output_tail(bytes: &[u8], max: usize) -> String {
    let text = String::from_utf8_lossy(bytes);
    if text.len() <= max {
        text.to_string()
    } else {
        text[text.len() - max..].to_string()
    }
}

/// Dunne wrapper: laat `run_batch_inner` het echte werk doen en legt de
/// uitkomst — wat er ook gebeurde — blijvend vast via `record_fire`. Zonder
/// dit was de enige sporen van een run de `eprintln!`'s onderweg, die
/// verdwijnen zodra de terminal dicht is. Precies dat gat maakte het
/// onmogelijk om achteraf te reconstrueren of een gemiste nacht een gemist
/// tijdvenster was of een stille fout.
fn run_batch(app: &AppHandle, managed: ManagedState, paths: Arc<Mutex<HashMap<String, String>>>) {
    let summary = run_batch_inner(app, managed, paths);
    eprintln!("[nightly] {summary}");
    record_fire(summary);
}

/// Haalt openstaande prompts op, matcht ze op project, en voert ze daarna
/// strikt na elkaar uit — ongeacht welk project erbij hoort. Was eerst
/// parallel per project (met alleen serieel binnen één project), maar dat
/// liet meerdere `claude`-processen tegelijk starten (elk zijn eigen
/// hooks-bestand aanmakend, allemaal om CPU/geheugen concurrerend) en dat
/// liep in de praktijk vast. Eén sessie tegelijk is trager maar betrouwbaar.
fn run_batch_inner(app: &AppHandle, managed: ManagedState, paths: Arc<Mutex<HashMap<String, String>>>) -> String {
    let Some(base) = crate::secrets::secret_get(SUPABASE_URL_ACCOUNT.to_string()).filter(|u| !u.is_empty()) else {
        return "Geen Supabase-URL ingesteld — nachtrun overgeslagen.".to_string();
    };
    let Some(key) = crate::secrets::secret_get(SUPABASE_KEY_ACCOUNT.to_string()).filter(|k| !k.is_empty()) else {
        return "Geen Supabase-sleutel ingesteld — nachtrun overgeslagen.".to_string();
    };

    let client = match reqwest::blocking::Client::builder().timeout(Duration::from_secs(15)).build() {
        Ok(c) => c,
        Err(e) => return format!("HTTP-client opzetten mislukt: {e}"),
    };

    let prompts = match fetch_pending(&client, &base, &key) {
        Ok(p) => p,
        Err(e) => return e,
    };
    if prompts.is_empty() {
        return "Geen pending prompts gevonden — niets te doen.".to_string();
    }
    let total = prompts.len();
    eprintln!("[nightly] {total} pending prompt(s) gevonden.");

    let known_paths = paths.lock().unwrap().clone();
    eprintln!("[nightly] {} lokaal bekende project(en): {:?}", known_paths.len(), known_paths.keys().collect::<Vec<_>>());

    // Matchen, met behoud van de created_at-volgorde uit de query — dat wordt
    // ook de uitvoervolgorde, over projecten heen.
    let mut queue: Vec<(String, String, PromptRow)> = Vec::new();
    for p in prompts {
        let Some(name) = p.pp_projects.as_ref().map(|r| r.name.clone()) else {
            eprintln!("[nightly] Prompt \"{}\" heeft geen gekoppeld project — gemarkeerd als failed.", p.title);
            fail_unmatched(&client, &base, &key, &p, "Geen gekoppeld project in PromptPad.");
            continue;
        };
        let key_norm = crate::git::project_key(&name);
        match known_paths.get(&key_norm) {
            Some(path) => queue.push((key_norm, path.clone(), p)),
            None => {
                eprintln!("[nightly] Prompt \"{}\" voor project \"{name}\" niet gevonden op deze Mac — gemarkeerd als failed.", p.title);
                let reason = format!(
                    "Project \"{name}\" niet gevonden op deze Mac (nog niet gescand, of de naam komt niet overeen met een ProjectRadar-project)."
                );
                fail_unmatched(&client, &base, &key, &p, &reason);
            }
        }
    }

    if queue.is_empty() {
        return format!("{total} pending prompt(s) gevonden, maar geen enkele gematcht op een lokaal project.");
    }
    let matched = queue.len();
    eprintln!("[nightly] {matched} prompt(s) gematcht — worden strikt na elkaar uitgevoerd.");

    let mut started = 0;
    for (project_key, path, prompt) in queue {
        if !claim(&client, &base, &key, &prompt.id) {
            eprintln!("[nightly] Claimen van \"{}\" mislukt (al door iemand anders opgepikt, of de patch faalde).", prompt.title);
            continue;
        }
        let line = match crate::git::claude_shell_line_capture_exit(&path, &prompt.body) {
            Ok(l) => l,
            Err(e) => { eprintln!("[nightly] Shell-regel bouwen mislukt: {e}"); finish(&client, &base, &key, &prompt.id, false, &e); continue; }
        };
        let (id, rx) = spawn_managed(&managed, path.clone(), line, project_key.clone(), prompt.title.clone());
        eprintln!("[nightly] Sessie {id} gestart voor \"{}\".", prompt.title);
        started += 1;
        let _ = app.emit("nightly-session-started", id);
        let ok = rx.recv().unwrap_or(false); // blokkeert: volgende prompt wacht tot deze klaar is
        let tail = managed
            .sessions
            .lock()
            .unwrap()
            .get(&id)
            .map(|s| last_output_tail(&s.output, 4000))
            .unwrap_or_default();
        finish(&client, &base, &key, &prompt.id, ok, &tail);
        let _ = app.emit("nightly-session-update", id);
    }
    format!("{total} pending prompt(s) gevonden, {matched} gematcht, {started} gestart. Uitkomst per prompt staat in Supabase.")
}

/// Lokale kalenderdag, niet UTC — moet in dezelfde klok blijven als de
/// uur-check in `start()` hieronder. Door dit te mixen met UTC zou de
/// "vandaag al gedraaid"-markering in sommige tijdzones een dag kunnen
/// verschuiven t.o.v. het venster waarin 'm gezet wordt.
fn today_str() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

/// Achtergrondtaak: elke minuut checken of het venster [03:00, 06:00) lokale
/// tijd is aangebroken en de batch dat kalenderjaar-dag nog niet gedraaid
/// heeft. De "laatst gedraaid"-markering staat in de keychain (goedkoop
/// hergebruik van bestaande opslag, geen apart bestand nodig) en wordt
/// meteen bij het starten gezet — niet pas na afloop — zodat een gedeeltelijk
/// mislukte batch niet dezelfde nacht opnieuw afvuurt.
pub fn start(app: AppHandle, managed: ManagedState, paths: Arc<Mutex<HashMap<String, String>>>) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(60));
        touch_tick();
        let now = chrono::Local::now();
        let hour = now.format("%H").to_string().parse::<u32>().unwrap_or(0);
        if hour < FIRE_HOUR_START || hour >= FIRE_HOUR_END {
            continue;
        }
        let today = today_str();
        if crate::secrets::secret_get(LAST_RUN_ACCOUNT.to_string()).as_deref() == Some(today.as_str()) {
            continue;
        }
        let _ = crate::secrets::secret_set(LAST_RUN_ACCOUNT.to_string(), today);
        run_batch(&app, managed.clone(), paths.clone());
    });
}
