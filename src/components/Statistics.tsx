import { useMemo } from "react";
import type { Project, RepoInfo } from "../types";
import { STATUS_LABEL } from "../types";
import { projectStats, summarize, barHeights, peakWeek, type ProjectStat } from "../lib/stats";

const BADGE_CLASS: Record<string, string> = {
  idee: "b-idee",
  actief: "b-actief",
  onhold: "b-onhold",
  afgerond: "b-afgerond",
};

/** "deze week", "vorige week", "3 wk terug" — kort genoeg voor een as-label. */
function weekLabel(index: number): string {
  if (index === 0) return "deze week";
  if (index === 1) return "vorige week";
  return `${index} wk terug`;
}

function plural(n: number, enkel: string, meer: string): string {
  return `${n} ${n === 1 ? enkel : meer}`;
}

/**
 * Balkjes van oud naar nieuw (links → rechts), dus de reeks wordt omgedraaid:
 * index 0 uit de backend is de afgelopen 7 dagen en hoort helemaal rechts.
 */
function Bars({ weeks, max, tall }: { weeks: number[]; max: number; tall?: boolean }) {
  const heights = barHeights(weeks, max);
  return (
    <div className={`st-bars${tall ? " tall" : ""}`}>
      {weeks
        .map((n, i) => ({ n, i, h: heights[i] }))
        .reverse()
        .map(({ n, i, h }) => (
          <div
            className={`st-bar${i === 0 ? " now" : ""}${n === 0 ? " nil" : ""}`}
            key={i}
            title={`${weekLabel(i)}: ${plural(n, "commit", "commits")}`}
          >
            <div className="st-bar-fill" style={{ height: `${Math.round(h * 100)}%` }} />
          </div>
        ))}
    </div>
  );
}

function StatRow({ stat, max }: { stat: ProjectStat; max: number }) {
  return (
    <div className="st-row">
      <div className="st-row-name">
        <span className="st-name">{stat.name}</span>
        <span className={`badge ${BADGE_CLASS[stat.status]}`}>{STATUS_LABEL[stat.status]}</span>
      </div>
      <Bars weeks={stat.weeks} max={max} />
      <div className="st-row-num">
        <b>{stat.thisWeek}</b>
        <span>deze week</span>
      </div>
      <div className="st-row-num">
        <b>{stat.total}</b>
        <span>totaal</span>
      </div>
    </div>
  );
}

export default function Statistics({
  repos,
  projects,
  scanned,
}: {
  /** Repo's uit de scan van deze PC; dragen de weekhistorie. */
  repos: RepoInfo[];
  /** Gecombineerd projectbeeld — levert naam en status. */
  projects: Project[];
  /** Is er al een scan geweest? Zo niet: lege staat i.p.v. nullen. */
  scanned: boolean;
}) {
  const stats = useMemo(() => projectStats(repos, projects), [repos, projects]);
  const sum = useMemo(() => summarize(stats, projects), [stats, projects]);
  const max = useMemo(() => peakWeek(stats), [stats]);
  // De drukste week bepaalt ook de schaal van de totaalgrafiek, maar die telt
  // alle projecten op en piekt dus hoger dan een losse projectbalk.
  const totalMax = useMemo(() => Math.max(0, ...sum.weeks), [sum.weeks]);

  if (!scanned || stats.length === 0) {
    return (
      <main className="main">
        <div className="top">
          <div>
            <h1>Statistieken</h1>
            <div className="sub">Commits per week en hoeveel projecten er echt lopen</div>
          </div>
        </div>
        <div className="empty">
          <div className="big">▤</div>
          <h2>Nog niets te tellen</h2>
          <p>
            Zodra er een scan is gedraaid, verschijnt hier per project de commit-activiteit
            van de afgelopen weken.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="main">
      <div className="top">
        <div>
          <h1>Statistieken</h1>
          <div className="sub">
            Commits per week over {plural(sum.windowWeeks, "week", "weken")} · gemeten op deze PC
          </div>
        </div>
      </div>

      <div className="st-kpis">
        <div className="st-kpi">
          <b>{sum.active}</b>
          <span>{sum.active === 1 ? "actief project" : "actieve projecten"}</span>
          <em>van {sum.projects} in totaal</em>
        </div>
        <div className="st-kpi">
          <b>{sum.thisWeek}</b>
          <span>commits deze week</span>
          <em>
            over {plural(stats.filter((s) => s.thisWeek > 0).length, "project", "projecten")}
          </em>
        </div>
        <div className="st-kpi">
          <b>{sum.perWeek}</b>
          <span>commits per week</span>
          <em>gemiddeld over {plural(sum.windowWeeks, "week", "weken")}</em>
        </div>
        <div className="st-kpi">
          <b>{sum.withCommits}</b>
          <span>{sum.withCommits === 1 ? "project met commits" : "projecten met commits"}</span>
          <em>
            {sum.projects - sum.withCommits === 1
              ? "1 lag stil"
              : `${sum.projects - sum.withCommits} lagen stil`}
          </em>
        </div>
      </div>

      <div className="panel">
        <h2>Alle projecten samen</h2>
        <p className="hint">
          Commits per rollende week van 7 dagen, oudste links. De rechterbalk is de
          afgelopen week.
        </p>
        <Bars weeks={sum.weeks} max={totalMax} tall />
        <div className="st-axis">
          <span>{plural(sum.windowWeeks, "week", "weken")} terug</span>
          <span>nu</span>
        </div>
      </div>

      <div className="panel">
        <h2>Per project</h2>
        <p className="hint">
          Hoogste totaal eerst. Balkjes zijn onderling vergelijkbaar: ze delen dezelfde
          schaal, met {plural(max, "commit", "commits")} in de drukste week als maximum.
        </p>
        <div className="st-rows">
          {stats.map((s) => (
            <StatRow key={s.key} stat={s} max={max} />
          ))}
        </div>
      </div>
    </main>
  );
}
