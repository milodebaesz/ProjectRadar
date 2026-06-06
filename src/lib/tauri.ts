import { invoke, Channel } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openPath as openFsPath, openUrl } from "@tauri-apps/plugin-opener";
import type { MachineInfo, ScanResult } from "../types";

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
