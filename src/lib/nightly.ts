import type { NightlyRun, RunOutcome } from "./tauri";

/**
 * Groeperen en samenvatten van het nachtjournaal voor het ochtendoverzicht.
 * Losse, pure functies zodat de weergave zelf niets hoeft te rekenen.
 */

export interface NightSummary {
  done: number;
  failed: number;
  skipped: number;
  total: number;
}

export interface NightGroup {
  /** Kalenderdatum (YYYY-MM-DD) waarop de runs startten. */
  date: string;
  /** "Vannacht", "Gisternacht", of een uitgeschreven datum. */
  label: string;
  runs: NightlyRun[];
  summary: NightSummary;
}

/** Lokale kalenderdatum als YYYY-MM-DD; null bij een onleesbare datum. */
function dayKey(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function summarize(runs: NightlyRun[]): NightSummary {
  const count = (o: RunOutcome) => runs.filter((r) => r.outcome === o).length;
  return {
    done: count("done"),
    failed: count("failed"),
    skipped: count("skipped"),
    total: runs.length,
  };
}

/**
 * Groepeer runs per nacht, nieuwste nacht eerst.
 *
 * Groeperen op kalenderdatum kan omdat het venster 03:00–06:00 is: een run
 * draagt dus altijd de datum van de ochtend waarop je 'm leest. Zou het
 * venster ooit over middernacht heen lopen, dan valt één nacht in twee
 * groepen uiteen en moet dit mee veranderen.
 */
export function groupByNight(runs: NightlyRun[], now: number = Date.now()): NightGroup[] {
  const today = dayKey(new Date(now).toISOString());
  const yesterday = dayKey(new Date(now - 86_400_000).toISOString());

  const byDay = new Map<string, NightlyRun[]>();
  for (const r of runs) {
    const key = dayKey(r.startedAt) ?? "onbekend";
    const arr = byDay.get(key) ?? [];
    arr.push(r);
    byDay.set(key, arr);
  }

  return [...byDay.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, list]) => ({
      date,
      label: date === today ? "Vannacht" : date === yesterday ? "Gisternacht" : labelFor(date),
      // Binnen een nacht chronologisch: zo lees je de nacht na zoals hij liep.
      runs: [...list].sort(
        (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
      ),
      summary: summarize(list),
    }));
}

function labelFor(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" });
}

/** Runs die gestart zijn ná het moment dat je het overzicht voor het laatst zag. */
export function unseenRuns(runs: NightlyRun[], seenAt: string | null): NightlyRun[] {
  if (!seenAt) return runs;
  const since = new Date(seenAt).getTime();
  if (Number.isNaN(since)) return runs;
  return runs.filter((r) => new Date(r.startedAt).getTime() > since);
}

/** Korte samenvatting in gewone taal, bijv. "2 klaar, 1 mislukt". */
export function summaryText(s: NightSummary): string {
  const delen: string[] = [];
  if (s.done) delen.push(`${s.done} klaar`);
  if (s.failed) delen.push(`${s.failed} mislukt`);
  if (s.skipped) delen.push(`${s.skipped} overgeslagen`);
  return delen.join(", ") || "niets uitgevoerd";
}

export const OUTCOME_LABEL: Record<RunOutcome, string> = {
  done: "Klaar",
  failed: "Mislukt",
  skipped: "Overgeslagen",
};

/** Looptijd als "12 min" / "1u 04m"; leeg als de run niet afgerond is. */
export function durationOf(run: NightlyRun): string {
  if (!run.finishedAt) return "";
  const ms = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
  if (Number.isNaN(ms) || ms < 0) return "";
  const min = Math.round(ms / 60_000);
  if (min < 1) return "< 1 min";
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)}u ${`${min % 60}`.padStart(2, "0")}m`;
}

/** Tijdstip van starten als HH:MM. */
export function timeOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
}
