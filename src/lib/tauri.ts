import { invoke, Channel } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openPath as openFsPath, openUrl } from "@tauri-apps/plugin-opener";
import type { MachineInfo, ProjectMeta, ScanResult } from "../types";
import type { ScheduleEntry } from "./model";

/** Draait de app in een echte Tauri-shell (vs. browser/preview)? */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function scanRoots(roots: string[]): Promise<ScanResult> {
  return invoke<ScanResult>("scan_roots", { roots });
}

export async function gitInit(path: string): Promise<void> {
  return invoke<void>("git_init", { path });
}

/**
 * Herlees het `.projectradar.json` van één project. `null` = geen bestand;
 * ongeldige JSON gooit, zodat de UI dat kan melden.
 */
export async function readRadarFile(path: string): Promise<Partial<ProjectMeta> | null> {
  return invoke<Partial<ProjectMeta> | null>("read_radar_file", { path });
}

/** Bouw de shell-regel om Claude Code te starten (schrijft prompt + hooks). */
export async function claudeShellLine(path: string, prompt: string): Promise<string> {
  return invoke<string>("claude_shell_line", { path, prompt });
}

// ── Ingebouwde terminal (PTY) ──

/** Start een interactieve shell in `cwd`; output stroomt via `onData`. */
export async function ptySpawn(
  onData: Channel<number[]>,
  cwd: string,
  cols: number,
  rows: number,
): Promise<number> {
  return invoke<number>("pty_spawn", { onData, cwd, cols, rows });
}

/** Schrijf invoer naar een terminalsessie. */
export async function ptyWrite(id: number, data: string): Promise<void> {
  return invoke<void>("pty_write", { id, data });
}

/** Pas de grootte van een terminalsessie aan. */
export async function ptyResize(id: number, cols: number, rows: number): Promise<void> {
  return invoke<void>("pty_resize", { id, cols, rows });
}

/** Beëindig een terminalsessie. */
export async function ptyKill(id: number): Promise<void> {
  return invoke<void>("pty_kill", { id });
}

export interface ClaudeStatusRow {
  path: string;
  state: string; // "busy" | "idle"
  ts: number; // epoch-seconden
}

/** Live Claude-status per projectmap (uit de hook-statusbestanden). */
export async function claudeStatus(): Promise<ClaudeStatusRow[]> {
  return invoke<ClaudeStatusRow[]>("claude_status");
}

/** Verplaats een map naar de prullenbak (herstelbaar). */
export async function trashPath(path: string): Promise<void> {
  return invoke<void>("trash_path", { path });
}

/** Luistert er al iets op 127.0.0.1:port? */
export async function checkPort(port: number): Promise<boolean> {
  return invoke<boolean>("check_port", { port });
}

/** Open een URL in Chrome (val terug op standaardbrowser). */
export async function openBrowser(url: string): Promise<void> {
  return invoke<void>("open_browser", { url });
}

/** Poll tot de dev-server op `port` luistert (of de timeout verstrijkt). */
export async function waitForPort(port: number, timeoutMs = 30000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await checkPort(port)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

export async function machineInfo(): Promise<MachineInfo> {
  return invoke<MachineInfo>("machine_info");
}

// ── Geheimen (OS-keychain) ──

/** Bewaar een geheim (bijv. het GitHub-token) veilig in de OS-keychain. */
export async function secretSet(account: string, value: string): Promise<void> {
  return invoke<void>("secret_set", { account, value });
}

/** Lees een geheim uit de OS-keychain; null als het er niet is. */
export async function secretGet(account: string): Promise<string | null> {
  return invoke<string | null>("secret_get", { account });
}

/** Verwijder een geheim uit de OS-keychain. */
export async function secretDelete(account: string): Promise<void> {
  return invoke<void>("secret_delete", { account });
}

/** Vaste account-naam waaronder het GitHub-token in de keychain staat. */
export const GITHUB_TOKEN_KEY = "github-token";

/** Native mappenkiezer; geeft het gekozen pad of null bij annuleren. */
export async function pickFolder(): Promise<string | null> {
  const res = await openDialog({ directory: true, multiple: false });
  if (typeof res === "string") return res;
  return null;
}

/** Open een pad of URL in de standaardapp (Finder/editor/browser). */
export async function openPath(target: string): Promise<void> {
  if (/^[a-z]+:\/\//i.test(target)) {
    await openUrl(target);
  } else {
    await openFsPath(target);
  }
}

// ── Autonome scheduler (geplande sprint-starts, draait als OS-thread in Rust) ──

/** Plan een sprint-start in (of werk 'm bij) bij de Rust-scheduler. */
export async function scheduleSet(entry: ScheduleEntry): Promise<void> {
  return invoke<void>("schedule_set", { entry });
}

/** Haal een geplande start weer weg. */
export async function scheduleClear(id: string): Promise<void> {
  return invoke<void>("schedule_clear", { id });
}

export interface FiredSchedule {
  id: string;
  projectKey: string;
  phaseName: string;
  firedAtMs: number;
  logPath: string;
}

/** Haal alle sinds de vorige keer afgevuurde geplande runs op (en wis de queue). */
export async function takeFiredSchedules(): Promise<FiredSchedule[]> {
  return invoke<FiredSchedule[]>("take_fired_schedules");
}

/** Lees het logbestand van een autonome run terug. */
export async function readLogFile(path: string): Promise<string> {
  return invoke<string>("read_log_file", { path });
}

// ── Externe bediening via Tailscale ──

export interface RemoteInfo {
  active: boolean;
  url: string | null;
}

/** Is de Tailscale-server actief, en zo ja, op welke URL? */
export async function remoteInfo(): Promise<RemoteInfo> {
  return invoke<RemoteInfo>("remote_info");
}

/** Stuur de laatste projectstatus door naar de Rust-cache, voor `/api/state`. */
export async function pushRemoteState(value: unknown): Promise<void> {
  return invoke<void>("push_remote_state", { value });
}

/** Haal het huidige pairing-token op (wordt eenmalig aangemaakt). */
export async function remoteTokenGet(): Promise<string> {
  return invoke<string>("remote_token_get");
}

/** Vervang het pairing-token door een nieuwe (bijv. na een vermoeden van lekken). */
export async function remoteTokenRegenerate(): Promise<string> {
  return invoke<string>("remote_token_regenerate");
}

// ── Nachtelijke prompt-runner (PromptPad) ──

/** Supabase-URL + sleutel opslaan (sleutel gaat naar de keychain, komt nooit terug). */
export async function nightlyConfigSet(url: string, key: string): Promise<void> {
  return invoke<void>("nightly_config_set", { url, key });
}

/** Alleen de URL — voor tonen in Instellingen. `null` = nog niet geconfigureerd. */
export async function nightlyConfigGet(): Promise<string | null> {
  return invoke<string | null>("nightly_config_get");
}

export async function nightlyConfigClear(): Promise<void> {
  return invoke<void>("nightly_config_clear");
}

/** Lokale paden van deze PC pushen, zodat de Rust-kant projecten kan vinden
 * zonder zelf te hoeven scannen (roots kent hij niet). */
export async function pushProjectPaths(paths: [string, string][]): Promise<void> {
  return invoke<void>("push_project_paths", { paths });
}

export type NightlySessionStatus = "running" | "done" | "failed";

export interface NightlySessionInfo {
  id: number;
  projectKey: string;
  title: string;
  status: NightlySessionStatus;
}

export async function nightlySessions(): Promise<NightlySessionInfo[]> {
  return invoke<NightlySessionInfo[]>("nightly_sessions");
}

export interface NightlyReadResult {
  chunk: string;
  nextOffset: number;
  status: NightlySessionStatus;
}

export async function nightlyRead(id: number, since: number): Promise<NightlyReadResult> {
  return invoke<NightlyReadResult>("nightly_read", { id, since });
}

/** Negeert het tijdvenster en de "vandaag al gedraaid"-markering — voor testen. */
export async function nightlyRunNow(): Promise<void> {
  return invoke<void>("nightly_run_now");
}

export interface NightlyStatusInfo {
  lastTickAt: string | null;
  lastFireAt: string | null;
  lastFireSummary: string | null;
}

/** Blijvende status van de achtergrondlus (overleeft een gesloten terminal). */
export async function nightlyStatus(): Promise<NightlyStatusInfo> {
  return invoke<NightlyStatusInfo>("nightly_status");
}

/** Afloop van één 's nachts opgepakte prompt. */
export type RunOutcome = "done" | "failed" | "skipped";

export interface NightlyRun {
  promptId: string;
  title: string;
  projectName: string;
  projectKey: string;
  startedAt: string;
  finishedAt: string | null;
  outcome: RunOutcome;
  /** Waarom overgeslagen of mislukt; leeg bij succes. */
  reason: string | null;
  /** Volledige output op schijf, te lezen met `readLogFile`. */
  logPath: string | null;
}

/** Het nachtjournaal, nieuwste eerst — voedt het ochtendoverzicht. */
export async function nightlyRuns(): Promise<NightlyRun[]> {
  return invoke<NightlyRun[]>("nightly_runs");
}
