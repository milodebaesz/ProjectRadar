import type { ProjectMeta, Settings } from "../types";

const SETTINGS_KEY = "projectradar.settings";
const META_KEY = "projectradar.meta";
const IGNORED_KEY = "projectradar.ignored";
const THEME_KEY = "projectradar.theme";
const PANELS_KEY = "projectradar.panels";
const NIGHTLY_SEEN_KEY = "projectradar.nightlySeenAt";

const DEFAULT_SETTINGS: Settings = {
  roots: [],
  machineLabel: "",
  rescanInterval: 0,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

/**
 * Eenmalige migratie: haal een eventueel oud (plaintext) GitHub-token uit de
 * settings in localStorage, verwijder het daar, en geef het terug zodat het naar
 * de OS-keychain verplaatst kan worden. Null als er niets te migreren is.
 */
export function takeLegacyGithubToken(): string | null {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    const tok = typeof obj.githubToken === "string" ? obj.githubToken.trim() : "";
    if ("githubToken" in obj) {
      delete obj.githubToken;
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(obj));
    }
    return tok ? tok : null;
  } catch {
    return null;
  }
}

/** Alle handmatige projectvelden, gekeyed op projectKey. */
export function loadAllMeta(): Record<string, ProjectMeta> {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function saveMeta(meta: ProjectMeta): void {
  const all = loadAllMeta();
  all[meta.key] = meta;
  localStorage.setItem(META_KEY, JSON.stringify(all));
}

export function getMeta(key: string): ProjectMeta {
  return loadAllMeta()[key] ?? { key };
}

/** Paden van niet-git mappen die de gebruiker heeft genegeerd. */
export function loadIgnored(): string[] {
  try {
    return JSON.parse(localStorage.getItem(IGNORED_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function addIgnored(path: string): void {
  const set = new Set(loadIgnored());
  set.add(path);
  localStorage.setItem(IGNORED_KEY, JSON.stringify([...set]));
}

/** In-/uitgeklapte staat van detail-panelen, gekeyed op `${projectKey}:${panelId}`. */
function loadAllPanelState(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(PANELS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function loadPanelCollapsed(id: string, fallback: boolean): boolean {
  const all = loadAllPanelState();
  return id in all ? all[id] : fallback;
}

export function savePanelCollapsed(id: string, collapsed: boolean): void {
  const all = loadAllPanelState();
  all[id] = collapsed;
  localStorage.setItem(PANELS_KEY, JSON.stringify(all));
}

/**
 * Wanneer je het nachtoverzicht voor het laatst bekeek. Bepaalt of er een
 * "nieuw"-markering staat; leeg = nog nooit gekeken, dan is alles nieuw.
 */
export function loadNightlySeenAt(): string | null {
  return localStorage.getItem(NIGHTLY_SEEN_KEY);
}

export function saveNightlySeenAt(iso: string): void {
  localStorage.setItem(NIGHTLY_SEEN_KEY, iso);
}

export function loadTheme(): "light" | "dark" {
  return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
}

export function saveTheme(t: "light" | "dark"): void {
  localStorage.setItem(THEME_KEY, t);
}
