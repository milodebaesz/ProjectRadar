import type { ProjectMeta } from "../types";
import { isLoggedIn } from "./pocketbase";
import { saveProjectMeta } from "./sync";

/**
 * Uitgestelde cloud-writes voor projectmeta.
 *
 * De lokale cache wordt elders meteen geschreven — die is goedkoop en houdt de
 * UI snel. Alleen de netwerk-PATCH staat hier in de wacht. Zonder dit leverde
 * elke toetsaanslag in het detailscherm een eigen request op: een omschrijving
 * van 200 tekens werd 200 PATCH-requests, die in willekeurige volgorde
 * afgehandeld konden worden — waarna een trage response een ouder
 * tekstfragment kon terugzetten.
 *
 * Per projectsleutel wordt alleen de laatste stand bewaard, dus opeenvolgende
 * bewerkingen vallen samen tot één write. Bewerkingen aan verschillende
 * projecten hebben elk hun eigen timer en verdringen elkaar niet.
 */

const DELAY_MS = 600;

/** Laatste nog niet weggeschreven stand per projectsleutel. */
const pending = new Map<string, ProjectMeta>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

let onError: ((e: unknown) => void) | null = null;

/** Waar mislukte writes gemeld worden (in de app: een toast). */
export function setCloudSaveErrorHandler(fn: (e: unknown) => void): void {
  onError = fn;
}

async function send(key: string): Promise<void> {
  const meta = pending.get(key);
  timers.delete(key);
  if (!meta) return;
  pending.delete(key);
  try {
    await saveProjectMeta(meta);
  } catch (e) {
    onError?.(e);
  }
}

/**
 * Zet een write in de wacht. No-op zonder login — dan is er geen cloud om
 * naartoe te schrijven en blijft alles bij de lokale cache.
 */
export function queueProjectMeta(meta: ProjectMeta): void {
  if (!isLoggedIn()) return;
  pending.set(meta.key, meta);
  const running = timers.get(meta.key);
  if (running) clearTimeout(running);
  timers.set(
    meta.key,
    setTimeout(() => {
      void send(meta.key);
    }, DELAY_MS),
  );
}

/**
 * Schrijf alles wat nog in de wacht staat meteen weg.
 *
 * Moet gebeuren vóór elke pull uit de cloud: haalt `fetchProjects` de
 * projecten op terwijl er nog een bewerking in de wacht staat, dan komt de
 * versie van vóór die bewerking terug en overschrijft die de UI-stand.
 */
export function flushProjectMeta(): Promise<void> {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  const keys = [...pending.keys()];
  return Promise.all(keys.map((k) => send(k))).then(() => undefined);
}

/** Staat er nog iets in de wacht? Alleen voor tests/diagnose. */
export function hasPendingProjectMeta(): boolean {
  return pending.size > 0;
}
