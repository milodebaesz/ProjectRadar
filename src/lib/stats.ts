import type { Project, RepoInfo, Status } from "../types";
import { projectKey } from "./format";
import { statusOf } from "./model";

/**
 * Rekenlaag voor de statistieken-view.
 *
 * De commit-historie komt uit `RepoInfo.commit_weeks` en dus uit de scan van
 * déze PC: de cloud bewaart alleen `weekly_commits`, geen weekreeks. De view
 * zegt dat er ook bij. De projectlijst dient alleen voor naam en status —
 * daarvoor is het gecombineerde (eventueel cloud-)beeld juist wél goed.
 */

/** Eén projectregel in de statistieken. */
export interface ProjectStat {
  key: string;
  name: string;
  status: Status;
  /** Commits per week, index 0 = de afgelopen 7 dagen. */
  weeks: number[];
  /** Commits in de afgelopen 7 dagen (= `weeks[0]`). */
  thisWeek: number;
  /** Commits over het hele venster. */
  total: number;
}

export interface StatsSummary {
  projects: number;
  active: number;
  /** Projecten met minstens één commit in het venster. */
  withCommits: number;
  thisWeek: number;
  total: number;
  /** Commits per week gemiddeld over het venster, op één decimaal. */
  perWeek: number;
  /** Commits per week over alle projecten samen, index 0 = afgelopen 7 dagen. */
  weeks: number[];
  /** Aantal weken in het venster; 0 als er niets gescand is. */
  windowWeeks: number;
}

/** Tel twee weekreeksen bij elkaar op; de langste bepaalt de lengte. */
function addWeeks(a: number[], b: number[]): number[] {
  const out = a.length >= b.length ? [...a] : [...b];
  const other = a.length >= b.length ? b : a;
  for (let i = 0; i < other.length; i++) out[i] += other[i];
  return out;
}

const sum = (xs: number[]) => xs.reduce((t, n) => t + n, 0);

/**
 * Bouw één regel per gescande repo, hoogste totaal eerst; bij gelijk totaal
 * op naam, zodat de volgorde niet wisselt tussen twee scans.
 *
 * Meerdere repo's kunnen tot hetzelfde project horen (dezelfde naam in twee
 * root-mappen); die tellen we op, net als `buildProjects` ze samenvoegt.
 */
export function projectStats(repos: RepoInfo[], projects: Project[]): ProjectStat[] {
  const byKey = new Map<string, Project>(projects.map((p) => [p.key, p]));
  const acc = new Map<string, ProjectStat>();

  for (const r of repos) {
    const key = projectKey(r.name);
    // Een oudere backend (of een cloud-only project) kent commit_weeks niet.
    const weeks = r.commit_weeks ?? [];
    const found = acc.get(key);
    if (found) {
      found.weeks = addWeeks(found.weeks, weeks);
      found.thisWeek = found.weeks[0] ?? 0;
      found.total = sum(found.weeks);
      continue;
    }
    const p = byKey.get(key);
    acc.set(key, {
      key,
      name: p?.name ?? r.name,
      status: p ? statusOf(p) : "idee",
      weeks: [...weeks],
      thisWeek: weeks[0] ?? 0,
      total: sum(weeks),
    });
  }

  return [...acc.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}

/** Kopregels: hoeveel projecten, hoeveel actief, en de commits daarachter. */
export function summarize(stats: ProjectStat[], projects: Project[]): StatsSummary {
  const weeks = stats.reduce<number[]>((acc, s) => addWeeks(acc, s.weeks), []);
  const total = sum(weeks);
  return {
    projects: projects.length,
    active: projects.filter((p) => statusOf(p) === "actief").length,
    withCommits: stats.filter((s) => s.total > 0).length,
    thisWeek: weeks[0] ?? 0,
    total,
    perWeek: weeks.length ? Math.round((total / weeks.length) * 10) / 10 : 0,
    weeks,
    windowWeeks: weeks.length,
  };
}

/**
 * Schaal een weekreeks naar balkhoogtes van 0–1 tegen een gedeeld maximum,
 * zodat sparklines van verschillende projecten onderling vergelijkbaar zijn.
 * Een week met commits krijgt altijd een zichtbare stomp (minimaal 0,08),
 * anders is "één commit" niet van "geen commit" te onderscheiden.
 */
export function barHeights(weeks: number[], max: number): number[] {
  if (max <= 0) return weeks.map(() => 0);
  return weeks.map((n) => (n === 0 ? 0 : Math.max(0.08, n / max)));
}

/** Hoogste weekwaarde over alle projecten; 0 als er nergens gecommit is. */
export function peakWeek(stats: ProjectStat[]): number {
  return stats.reduce((m, s) => Math.max(m, ...s.weeks, 0), 0);
}
