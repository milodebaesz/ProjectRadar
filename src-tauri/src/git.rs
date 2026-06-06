//! Lokale git-scan: vindt repo's onder de ingestelde root-mappen en leest hun
//! git-stand uit via de `git` CLI (conform PRD: begin met git-commando's).

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;

/// Hoe diep we in niet-git mappen afdalen op zoek naar repo's.
const MAX_DEPTH: usize = 3;

/// Mappen die we tijdens het scannen nooit binnengaan (zwaar of irrelevant).
const IGNORED_DIRS: &[&str] = &[
    "node_modules",
    "target",
    "dist",
    "build",
    "out",
    ".next",
    ".turbo",
    ".cache",
    "coverage",
    "vendor",
    "venv",
    ".venv",
    "__pycache__",
    "Pods",
    "DerivedData",
    ".gradle",
];

#[derive(Serialize)]
pub struct RepoInfo {
    pub path: String,
    pub name: String,
    pub branch: Option<String>,
    pub detached: bool,
    pub last_commit_hash: Option<String>,
    pub last_commit_message: Option<String>,
    /// ISO-8601 committer-datum van de laatste commit.
    pub last_commit_date: Option<String>,
    pub total_commits: u32,
    pub has_uncommitted: bool,
    pub remote_url: Option<String>,
    pub has_upstream: bool,
    pub ahead: u32,
    pub behind: u32,
    /// Automatisch herkende stack/taal op basis van marker-bestanden.
    pub detected_stack: Vec<String>,
    /// Auto-gedetecteerd start-commando op basis van package.json scripts.
    pub default_run_command: Option<String>,
    /// Auto-gedetecteerde dev-URL (poort + framework); None als geen webapp.
    pub default_dev_url: Option<String>,
    /// Inhoud van een `.projectradar.json` in de repo-root, indien aanwezig.
    /// Vorm sluit aan op `ProjectMeta` in de frontend.
    pub radar_meta: Option<serde_json::Value>,
}

/// Lees en parse een `.projectradar.json` uit de repo-root, indien aanwezig.
fn read_radar_meta(path: &Path) -> Option<serde_json::Value> {
    let file = path.join(".projectradar.json");
    let raw = std::fs::read_to_string(&file).ok()?;
    serde_json::from_str(&raw).ok()
}

#[derive(Serialize)]
pub struct NoGitFolder {
    pub path: String,
    pub name: String,
}

#[derive(Serialize)]
pub struct ScanResult {
    pub repos: Vec<RepoInfo>,
    pub no_git: Vec<NoGitFolder>,
}

/// Voer een git-commando uit in `dir` en geef de getrimde stdout terug bij succes.
fn git(dir: &Path, args: &[&str]) -> Option<String> {
    let out = Command::new("git").current_dir(dir).args(args).output().ok()?;
    if out.status.success() {
        Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        None
    }
}

fn is_git_repo(dir: &Path) -> bool {
    dir.join(".git").exists()
}

fn push_tag(tags: &mut Vec<String>, tag: &str) {
    let t = tag.to_string();
    if !tags.contains(&t) {
        tags.push(t);
    }
}

/// Herken globaal de stack/taal van een repo aan de hand van marker-bestanden.
fn detect_stack(path: &Path) -> Vec<String> {
    let mut tags: Vec<String> = Vec::new();

    if let Ok(content) = std::fs::read_to_string(path.join("package.json")) {
        match serde_json::from_str::<serde_json::Value>(&content) {
            Ok(json) => {
                let mut deps: Vec<String> = Vec::new();
                for key in ["dependencies", "devDependencies"] {
                    if let Some(obj) = json.get(key).and_then(|v| v.as_object()) {
                        deps.extend(obj.keys().cloned());
                    }
                }
                let has = |name: &str| deps.iter().any(|d| d == name);
                if has("next") {
                    push_tag(&mut tags, "Next.js");
                } else if has("react") {
                    push_tag(&mut tags, "React");
                }
                if has("vue") {
                    push_tag(&mut tags, "Vue");
                }
                if has("@sveltejs/kit") {
                    push_tag(&mut tags, "SvelteKit");
                } else if has("svelte") {
                    push_tag(&mut tags, "Svelte");
                }
                if has("astro") {
                    push_tag(&mut tags, "Astro");
                }
                if has("vite") {
                    push_tag(&mut tags, "Vite");
                }
                if has("tailwindcss") {
                    push_tag(&mut tags, "Tailwind");
                }
                if has("@supabase/supabase-js") {
                    push_tag(&mut tags, "Supabase");
                }
                if has("openai") {
                    push_tag(&mut tags, "OpenAI");
                }
                if has("@tauri-apps/api") || has("@tauri-apps/cli") {
                    push_tag(&mut tags, "Tauri");
                }
                if has("express") {
                    push_tag(&mut tags, "Express");
                }
                if has("typescript") {
                    push_tag(&mut tags, "TypeScript");
                }
                if tags.is_empty() {
                    push_tag(&mut tags, "Node");
                }
            }
            Err(_) => push_tag(&mut tags, "Node"),
        }
    }

    if let Ok(content) = std::fs::read_to_string(path.join("Cargo.toml")) {
        push_tag(&mut tags, "Rust");
        if content.contains("tauri") {
            push_tag(&mut tags, "Tauri");
        }
    }
    if path.join("pyproject.toml").exists()
        || path.join("requirements.txt").exists()
        || path.join("setup.py").exists()
    {
        push_tag(&mut tags, "Python");
    }
    if path.join("go.mod").exists() {
        push_tag(&mut tags, "Go");
    }
    if path.join("Gemfile").exists() {
        push_tag(&mut tags, "Ruby");
    }
    if path.join("composer.json").exists() {
        push_tag(&mut tags, "PHP");
    }
    if path.join("pom.xml").exists() || path.join("build.gradle").exists() {
        push_tag(&mut tags, "Java");
    }

    tags.truncate(5);
    tags
}

/// Leid een start-commando af uit de `scripts` in package.json (dev > start >
/// serve). Geeft None als er geen package.json of geen passend script is.
fn detect_run_command(path: &Path) -> Option<String> {
    let content = std::fs::read_to_string(path.join("package.json")).ok()?;
    let json: serde_json::Value = serde_json::from_str(&content).ok()?;
    let scripts = json.get("scripts")?.as_object()?;
    for key in ["dev", "start", "serve"] {
        if scripts.contains_key(key) {
            return Some(format!("npm run {key}"));
        }
    }
    None
}

/// Zoek een poortnummer in een commandoregel: `--port 5173`, `--port=5173`
/// of `-p 5173`.
fn port_from_flags(cmd: &str) -> Option<u16> {
    let tokens: Vec<&str> = cmd.split_whitespace().collect();
    for (i, tok) in tokens.iter().enumerate() {
        let val = if let Some(v) = tok.strip_prefix("--port=") {
            Some(v.to_string())
        } else if (*tok == "--port" || *tok == "-p") && i + 1 < tokens.len() {
            Some(tokens[i + 1].to_string())
        } else {
            None
        };
        if let Some(v) = val {
            if let Ok(p) = v.trim_matches(|c: char| !c.is_ascii_digit()).parse::<u16>() {
                return Some(p);
            }
        }
    }
    None
}

/// Eerste `port: <getal>` uit een config-bestand (bijv. vite.config.ts).
fn port_from_config(content: &str) -> Option<u16> {
    let idx = content.find("port")?;
    let rest = &content[idx + 4..];
    // Sla `:`, `=` en spaties over tot de eerste cijferreeks.
    let digits: String = rest
        .chars()
        .skip_while(|c| !c.is_ascii_digit())
        .take_while(|c| c.is_ascii_digit())
        .collect();
    digits.parse::<u16>().ok()
}

/// Bepaal de poort van de dev-server: dev-script flags > vite-config > None.
fn detect_port(path: &Path) -> Option<u16> {
    if let Ok(content) = std::fs::read_to_string(path.join("package.json")) {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(scripts) = json.get("scripts").and_then(|v| v.as_object()) {
                for key in ["dev", "start", "serve"] {
                    if let Some(cmd) = scripts.get(key).and_then(|v| v.as_str()) {
                        if let Some(p) = port_from_flags(cmd) {
                            return Some(p);
                        }
                    }
                }
            }
        }
    }
    for name in ["vite.config.ts", "vite.config.js", "vite.config.mjs"] {
        if let Ok(content) = std::fs::read_to_string(path.join(name)) {
            if let Some(p) = port_from_config(&content) {
                return Some(p);
            }
        }
    }
    None
}

/// Leid de dev-URL af uit de herkende stack. Tauri-apps openen hun eigen venster
/// en niet-web-stacks krijgen geen URL (None = geen browser openen).
fn detect_dev_url(path: &Path, stack: &[String]) -> Option<String> {
    let has = |name: &str| stack.iter().any(|s| s == name);
    if has("Tauri") {
        return None;
    }
    let default_port = if has("Next.js") {
        3000
    } else if has("Astro") {
        4321
    } else if has("Vite") || has("React") || has("Vue") || has("Svelte") || has("SvelteKit") {
        5173
    } else {
        return None;
    };
    let port = detect_port(path).unwrap_or(default_port);
    Some(format!("http://localhost:{port}"))
}

fn dir_name(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string())
}

fn is_ignored(name: &str) -> bool {
    name.starts_with('.') || IGNORED_DIRS.contains(&name)
}

/// Lees de git-stand van één repo uit.
fn read_repo(path: &Path) -> RepoInfo {
    let branch_raw = git(path, &["rev-parse", "--abbrev-ref", "HEAD"]);
    let detached = branch_raw.as_deref() == Some("HEAD");
    let branch = if detached {
        // Bij detached HEAD tonen we de korte hash i.p.v. "HEAD".
        git(path, &["rev-parse", "--short", "HEAD"])
    } else {
        branch_raw
    };

    // Laatste commit: hash \x1f ISO-datum \x1f onderwerp.
    let mut last_commit_hash = None;
    let mut last_commit_message = None;
    let mut last_commit_date = None;
    if let Some(line) = git(path, &["log", "-1", "--format=%h%x1f%cI%x1f%s"]) {
        let mut parts = line.splitn(3, '\u{1f}');
        last_commit_hash = parts.next().map(|s| s.to_string()).filter(|s| !s.is_empty());
        last_commit_date = parts.next().map(|s| s.to_string()).filter(|s| !s.is_empty());
        last_commit_message = parts.next().map(|s| s.to_string()).filter(|s| !s.is_empty());
    }

    let total_commits = git(path, &["rev-list", "--count", "HEAD"])
        .and_then(|s| s.parse::<u32>().ok())
        .unwrap_or(0);

    let has_uncommitted = git(path, &["status", "--porcelain"])
        .map(|s| !s.is_empty())
        .unwrap_or(false);

    let remote_url = git(path, &["remote", "get-url", "origin"]);

    // ahead/behind t.o.v. de upstream-branch.
    let mut has_upstream = false;
    let mut ahead = 0;
    let mut behind = 0;
    if let Some(counts) = git(
        path,
        &["rev-list", "--left-right", "--count", "@{upstream}...HEAD"],
    ) {
        has_upstream = true;
        let nums: Vec<u32> = counts
            .split_whitespace()
            .filter_map(|n| n.parse().ok())
            .collect();
        if nums.len() == 2 {
            behind = nums[0]; // commits in upstream, niet in HEAD
            ahead = nums[1]; // commits in HEAD, niet in upstream
        }
    }

    let stack = detect_stack(path);

    RepoInfo {
        path: path.to_string_lossy().to_string(),
        name: dir_name(path),
        branch,
        detached,
        last_commit_hash,
        last_commit_message,
        last_commit_date,
        total_commits,
        has_uncommitted,
        remote_url,
        has_upstream,
        ahead,
        behind,
        detected_stack: stack.clone(),
        default_run_command: detect_run_command(path),
        default_dev_url: detect_dev_url(path, &stack),
        radar_meta: read_radar_meta(path),
    }
}

/// Verzamel repo's vanaf `dir`. Een git-repo stopt het verder afdalen.
fn collect_repos(dir: &Path, depth: usize, out: &mut Vec<RepoInfo>) {
    if is_git_repo(dir) {
        out.push(read_repo(dir));
        return;
    }
    if depth >= MAX_DEPTH {
        return;
    }
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = dir_name(&path);
        if is_ignored(&name) {
            continue;
        }
        collect_repos(&path, depth + 1, out);
    }
}

/// Scan alle root-mappen. Direct-onderliggende mappen zonder enige git-repo
/// erin worden als "nog geen git" teruggegeven.
pub fn scan_roots(roots: Vec<String>) -> ScanResult {
    let mut repos: Vec<RepoInfo> = Vec::new();
    let mut no_git: Vec<NoGitFolder> = Vec::new();

    for root in roots {
        let root_path = PathBuf::from(&root);
        let entries = match std::fs::read_dir(&root_path) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let child = entry.path();
            if !child.is_dir() {
                continue;
            }
            let name = dir_name(&child);
            if is_ignored(&name) {
                continue;
            }
            let mut found: Vec<RepoInfo> = Vec::new();
            collect_repos(&child, 0, &mut found);
            if found.is_empty() {
                no_git.push(NoGitFolder {
                    path: child.to_string_lossy().to_string(),
                    name,
                });
            } else {
                repos.extend(found);
            }
        }
    }

    // Stabiele, voorspelbare volgorde op naam.
    repos.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    no_git.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    ScanResult { repos, no_git }
}

/// Escape een string zodat hij veilig binnen een AppleScript-string (dubbele
/// quotes) past: backslash en dubbele quote worden ge-escaped.
#[cfg(target_os = "macos")]
fn applescript_escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

/// Quote een pad voor gebruik binnen single quotes in een shell-commando.
fn shell_single_quote(s: &str) -> String {
    s.replace('\'', "'\\''")
}

/// Basismap voor Projectradar-data buiten de repo's (`~/.projectradar`).
fn projectradar_dir() -> Result<PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "HOME niet gevonden".to_string())?;
    Ok(PathBuf::from(home).join(".projectradar"))
}

/// Klein shell-scriptje dat per projectmap een statusbestand schrijft/verwijdert.
/// Wordt door de Claude-hooks aangeroepen met "busy" | "idle" | "end".
const STATUS_SCRIPT: &str = r#"#!/bin/sh
DIR="${CLAUDE_PROJECT_DIR:-$PWD}"
BASE="$HOME/.projectradar/claude"
mkdir -p "$BASE"
KEY=$(printf '%s' "$DIR" | shasum | cut -d' ' -f1)
F="$BASE/$KEY.json"
if [ "$1" = "end" ]; then
  rm -f "$F"
else
  printf '{"state":"%s","ts":%s,"path":"%s"}\n' "$1" "$(date +%s)" "$DIR" > "$F"
fi
"#;

/// Schrijf (idempotent) het status-script en een hooks-settings-bestand. Geeft
/// het pad naar beide terug: (hooks-json, status-script).
fn ensure_claude_hooks() -> Result<(PathBuf, PathBuf), String> {
    let base = projectradar_dir()?;
    std::fs::create_dir_all(&base).map_err(|e| format!("Map aanmaken mislukt: {e}"))?;

    let script = base.join("claude-status.sh");
    std::fs::write(&script, STATUS_SCRIPT).map_err(|e| format!("Script schrijven mislukt: {e}"))?;

    let script_q = shell_single_quote(&script.to_string_lossy());
    let cmd = |state: &str| {
        serde_json::json!({
            "hooks": [{ "type": "command", "command": format!("sh '{script_q}' {state}") }]
        })
    };
    let hooks = serde_json::json!({
        "hooks": {
            "SessionStart": [cmd("idle")],
            "UserPromptSubmit": [cmd("busy")],
            // Ververst de "busy"-tijdstempel tijdens actief werk, zodat een
            // vastgelopen/afgebroken sessie als verouderd herkend kan worden.
            "PostToolUse": [cmd("busy")],
            "Stop": [cmd("idle")],
            "SessionEnd": [cmd("end")],
        }
    });
    let hooks_path = base.join("claude-hooks.json");
    std::fs::write(
        &hooks_path,
        serde_json::to_string_pretty(&hooks).unwrap_or_default(),
    )
    .map_err(|e| format!("Hooks schrijven mislukt: {e}"))?;

    Ok((hooks_path, script))
}

/// Bouw de shell-regel om Claude Code te starten met `prompt` als eerste bericht.
/// De prompt gaat via een tijdelijk bestand zodat aanhalingstekens/nieuwe regels
/// veilig zijn; het bestand wordt na inlezen meteen verwijderd. Hooks (via
/// --settings) houden de live bezig/idle-status bij. De regel wordt in een
/// ingebouwde terminal (PTY) uitgevoerd.
pub fn claude_shell_line(path: String, prompt: String) -> Result<String, String> {
    use std::time::{SystemTime, UNIX_EPOCH};
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let file = std::env::temp_dir().join(format!("projectradar-claude-{stamp}.md"));
    std::fs::write(&file, prompt).map_err(|e| format!("Prompt schrijven mislukt: {e}"))?;

    let (hooks_path, script) = ensure_claude_hooks()?;

    let file_q = shell_single_quote(&file.to_string_lossy());
    let path_q = shell_single_quote(&path);
    let hooks_q = shell_single_quote(&hooks_path.to_string_lossy());
    let script_q = shell_single_quote(&script.to_string_lossy());

    // Lees de prompt in en verwijder het bestand; markeer meteen "busy"; start
    // Claude met volledige permissies + hooks; markeer "end" zodra Claude stopt.
    Ok(format!(
        "cd '{path_q}' && PROMPT=\"$(cat '{file_q}')\" && rm -f '{file_q}' && sh '{script_q}' busy && claude --dangerously-skip-permissions --settings '{hooks_q}' \"$PROMPT\"; sh '{script_q}' end"
    ))
}

#[derive(Serialize)]
pub struct ClaudeStatus {
    pub path: String,
    pub state: String,
    pub ts: u64,
}

/// Lees alle Claude-statusbestanden uit `~/.projectradar/claude`.
pub fn claude_status() -> Vec<ClaudeStatus> {
    let base = match projectradar_dir() {
        Ok(b) => b.join("claude"),
        Err(_) => return Vec::new(),
    };
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&base) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.extension().and_then(|x| x.to_str()) != Some("json") {
                continue;
            }
            if let Ok(raw) = std::fs::read_to_string(&p) {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
                    let path = v.get("path").and_then(|x| x.as_str()).unwrap_or("").to_string();
                    let state = v.get("state").and_then(|x| x.as_str()).unwrap_or("").to_string();
                    let ts = v.get("ts").and_then(|x| x.as_u64()).unwrap_or(0);
                    if !path.is_empty() {
                        out.push(ClaudeStatus { path, state, ts });
                    }
                }
            }
        }
    }
    out
}

/// Probeer kort een TCP-verbinding naar 127.0.0.1:`port`; true = de dev-server
/// luistert al. De frontend pollt hierop tot de server klaar is.
pub fn check_port(port: u16) -> bool {
    use std::net::{SocketAddr, TcpStream};
    use std::time::Duration;
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&addr, Duration::from_millis(400)).is_ok()
}

/// Open een URL in Google Chrome; val terug op de standaardbrowser als Chrome
/// niet beschikbaar is.
pub fn open_browser(url: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let chrome = Command::new("open")
            .args(["-a", "Google Chrome", &url])
            .status();
        if matches!(chrome, Ok(s) if s.success()) {
            return Ok(());
        }
        Command::new("open")
            .arg(&url)
            .status()
            .map_err(|e| format!("Browser openen mislukt: {e}"))?;
        Ok(())
    }
    #[cfg(target_os = "linux")]
    {
        for prog in ["google-chrome", "chromium", "xdg-open"] {
            if Command::new(prog).arg(&url).spawn().is_ok() {
                return Ok(());
            }
        }
        Err("Geen browser gevonden om te openen.".into())
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        let _ = url;
        Err("Browser openen wordt op dit platform nog niet ondersteund.".into())
    }
}

/// Verplaats een map/bestand naar de prullenbak (herstelbaar), i.p.v. hard
/// verwijderen. macOS via Finder, Linux via `gio trash`/`trash` indien aanwezig.
pub fn trash_path(path: String) -> Result<(), String> {
    if !Path::new(&path).exists() {
        return Err("Pad bestaat niet (meer).".into());
    }
    #[cfg(target_os = "macos")]
    {
        let script = format!(
            "tell application \"Finder\" to delete (POSIX file \"{}\")",
            applescript_escape(&path)
        );
        let out = Command::new("osascript")
            .arg("-e")
            .arg(&script)
            .output()
            .map_err(|e| format!("osascript kon niet starten: {e}"))?;
        if out.status.success() {
            return Ok(());
        }
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    #[cfg(target_os = "linux")]
    {
        for (cmd, args) in [("gio", vec!["trash", &path]), ("trash", vec![path.as_str()])] {
            if let Ok(out) = Command::new(cmd).args(&args).output() {
                if out.status.success() {
                    return Ok(());
                }
            }
        }
        return Err("Geen prullenbak-commando (gio/trash) gevonden.".into());
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        Err("Naar prullenbak verplaatsen wordt op dit platform nog niet ondersteund.".into())
    }
}

/// Voer `git init` uit in een map.
pub fn git_init(path: String) -> Result<(), String> {
    let out = Command::new("git")
        .current_dir(&path)
        .arg("init")
        .output()
        .map_err(|e| format!("git init kon niet starten: {e}"))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}
