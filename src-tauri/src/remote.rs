//! Externe bediening via Tailscale: een kleine HTTP-server die de laatst
//! bekende staat van de app blootlegt en acties (mijlpaal afvinken, sprint
//! starten) doorstuurt naar de webview via een Tauri-event.
//!
//! Bewuste architectuurkeuze: deze server is een **dunne brug**, geen tweede
//! bron van waarheid. Roadmap en geschiedenis blijven volledig eigendom van
//! de webview (localStorage/cloud) — Rust cachet alleen de laatst doorgegeven
//! JSON-snapshot (via `push_remote_state`) voor `GET /api/state`, en stuurt
//! acties als event door naar de webview, die ze afhandelt via dezelfde
//! `onSave`/`onClaude`-paden als een klik in de UI. Zo hoeft er geen
//! businesslogica gedupliceerd te worden (in tegenstelling tot de
//! sprint-scheduler, die wél autonoom moet kunnen draaien zonder webview).
//!
//! Veiligheid: de server bindt uitsluitend aan het Tailscale-IP (CGNAT-bereik
//! 100.64.0.0/10) — nooit aan 0.0.0.0 — zodat hij niet per ongeluk ook
//! bereikbaar is via het gewone thuisnetwerk. Is er geen Tailscale-interface
//! gevonden, dan start de server simpelweg niet. Daarbovenop is een
//! Bearer-token vereist (opgeslagen in de OS-keychain, zie `secrets.rs`) als
//! extra laag, mocht Tailscale ooit anders geconfigureerd worden dan verwacht.

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{Html, IntoResponse, Json},
    routing::{get, post},
    Router,
};
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::process::Command;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

const PORT: u16 = 4174;
const REMOTE_TOKEN_ACCOUNT: &str = "remote-token";

#[derive(Default)]
pub struct RemoteStateHandle(pub Arc<Mutex<Option<serde_json::Value>>>);

#[derive(Clone)]
struct RemoteCtx {
    state: Arc<Mutex<Option<serde_json::Value>>>,
    app: AppHandle,
    token: String,
}

#[derive(Serialize, Clone)]
pub struct RemoteInfo {
    pub active: bool,
    pub url: Option<String>,
}

/// Zoek het Tailscale-IP van deze Mac: een `utun*`-interface met een adres in
/// het CGNAT-bereik 100.64.0.0/10 (waar Tailscale in valt). Shelt uit naar
/// `ifconfig` i.p.v. een extra crate erbij te halen, consistent met de rest
/// van de backend (git.rs, secrets.rs).
pub fn find_tailscale_ip() -> Option<String> {
    let out = Command::new("ifconfig").output().ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let mut in_utun = false;
    for line in text.lines() {
        if !line.starts_with(['\t', ' ']) {
            in_utun = line.split(':').next().map(|n| n.starts_with("utun")).unwrap_or(false);
            continue;
        }
        if !in_utun {
            continue;
        }
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("inet ") {
            let ip = rest.split_whitespace().next().unwrap_or("");
            if is_tailscale_ip(ip) {
                return Some(ip.to_string());
            }
        }
    }
    None
}

fn is_tailscale_ip(ip: &str) -> bool {
    let parts: Vec<&str> = ip.split('.').collect();
    if parts.len() != 4 || parts[0] != "100" {
        return false;
    }
    parts[1].parse::<u8>().map(|b| (64..=127).contains(&b)).unwrap_or(false)
}

pub fn info() -> RemoteInfo {
    match find_tailscale_ip() {
        Some(ip) => RemoteInfo { active: true, url: Some(format!("http://{ip}:{PORT}")) },
        None => RemoteInfo { active: false, url: None },
    }
}

fn generate_token() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 24];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Haal het token op, of maak er eenmalig een aan.
pub fn ensure_token() -> String {
    if let Some(t) = crate::secrets::secret_get(REMOTE_TOKEN_ACCOUNT.to_string()) {
        if !t.is_empty() {
            return t;
        }
    }
    let token = generate_token();
    let _ = crate::secrets::secret_set(REMOTE_TOKEN_ACCOUNT.to_string(), token.clone());
    token
}

/// Vervang het token door een nieuwe (bijv. na een vermoeden dat het gelekt is).
pub fn regenerate_token() -> String {
    let token = generate_token();
    let _ = crate::secrets::secret_set(REMOTE_TOKEN_ACCOUNT.to_string(), token.clone());
    token
}

fn check_auth(headers: &HeaderMap, token: &str) -> bool {
    headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .map(|v| v == format!("Bearer {token}"))
        .unwrap_or(false)
}

async fn serve_page() -> Html<&'static str> {
    Html(include_str!("../assets/remote.html"))
}

async fn get_state(State(ctx): State<RemoteCtx>, headers: HeaderMap) -> impl IntoResponse {
    if !check_auth(&headers, &ctx.token) {
        return (StatusCode::UNAUTHORIZED, "unauthorized").into_response();
    }
    let guard = ctx.state.lock().unwrap();
    match &*guard {
        Some(v) => Json(v.clone()).into_response(),
        None => (StatusCode::SERVICE_UNAVAILABLE, "nog geen data (app net gestart?)").into_response(),
    }
}

#[derive(Deserialize)]
struct ActionRequest {
    #[serde(rename = "type")]
    kind: String,
    payload: serde_json::Value,
}

/// Stuurt de actie als event door naar de webview; die voert 'm uit via
/// dezelfde paden als een klik in de UI (zie `useRemoteBridge.ts`). Geeft
/// meteen 202 terug — de telefoon leest de uitkomst via de volgende
/// `/api/state`-poll (Claude-status, geschiedenis), niet via dit antwoord.
async fn post_action(
    State(ctx): State<RemoteCtx>,
    headers: HeaderMap,
    Json(body): Json<ActionRequest>,
) -> impl IntoResponse {
    if !check_auth(&headers, &ctx.token) {
        return (StatusCode::UNAUTHORIZED, "unauthorized").into_response();
    }
    let event_payload = serde_json::json!({ "type": body.kind, "payload": body.payload });
    let _ = ctx.app.emit("remote-action", event_payload);
    (StatusCode::ACCEPTED, "ok").into_response()
}

/// Start de server op een achtergrondtaak. Doet niets als er geen
/// Tailscale-IP gevonden wordt — er wordt bewust nooit teruggevallen op een
/// LAN-breed adres.
pub fn start(app: AppHandle, state: Arc<Mutex<Option<serde_json::Value>>>) {
    let Some(ip) = find_tailscale_ip() else {
        eprintln!("[remote] Geen Tailscale-IP gevonden — extern bereik staat uit.");
        return;
    };
    let token = ensure_token();
    let ctx = RemoteCtx { state, app, token };

    tauri::async_runtime::spawn(async move {
        let router = Router::new()
            .route("/", get(serve_page))
            .route("/api/state", get(get_state))
            .route("/api/action", post(post_action))
            .with_state(ctx);

        let addr: SocketAddr = format!("{ip}:{PORT}")
            .parse()
            .unwrap_or_else(|_| SocketAddr::from(([127, 0, 0, 1], PORT)));
        match tokio::net::TcpListener::bind(addr).await {
            Ok(listener) => {
                eprintln!("[remote] Server actief op http://{addr}");
                let _ = axum::serve(listener, router).await;
            }
            Err(e) => eprintln!("[remote] Server starten mislukt op {addr}: {e}"),
        }
    });
}
