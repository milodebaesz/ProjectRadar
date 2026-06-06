import type { ProjectMeta, Settings } from "../types";

const SETTINGS_KEY = "projectradar.settings";
const META_KEY = "projectradar.meta";
const IGNORED_KEY = "projectradar.ignored";
const THEME_KEY = "projectradar.theme";

const DEFAULT_SETTINGS: Settings = {
  roots: [],
  machineLabel: "",
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

export function loadTheme(): "light" | "dark" {
  return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
}

export function saveTheme(t: "light" | "dark"): void {
  localStorage.setItem(THEME_KEY, t);
}
