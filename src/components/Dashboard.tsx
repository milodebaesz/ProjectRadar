import { useMemo, useState } from "react";
import type { ClaudeState, NoGitFolder, Project, Status } from "../types";
import { byRank, effectiveStack, reorderProjects, statusOf } from "../lib/model";
import ProjectCard from "./ProjectCard";
import type { NightlyRun } from "../lib/tauri";
import { summarize, summaryText } from "../lib/nightly";

type Filter = "alle" | Status;
type Sort = "recent" | "naam" | "eigen";

const SORT_CYCLE: Record<Sort, Sort> = { recent: "naam", naam: "eigen", eigen: "recent" };
const SORT_LABEL: Record<Sort, string> = {
  recent: "Laatst gewijzigd",
  naam: "Naam",
  eigen: "Eigen volgorde",
};

const FILTERS: { key: Filter; label: string }[] = [
  { key: "alle", label: "Alle" },
  { key: "actief", label: "Actief" },
  { key: "idee", label: "Idee" },
  { key: "onhold", label: "On hold" },
  { key: "afgerond", label: "Afgerond" },
];

function lastActivity(p: Project): number {
  return p.states.reduce((max, s) => {
    const t = s.lastCommitDate ? new Date(s.lastCommitDate).getTime() : 0;
    return Math.max(max, t);
  }, 0);
}

interface Props {
  projects: Project[];
  claudeByKey: Record<string, ClaudeState>;
  noGit: NoGitFolder[];
  machineName: string;
  pcCount: number;
  scanning: boolean;
  theme: "light" | "dark";
  hasRoots: boolean;
  onToggleTheme: () => void;
  onScan: () => void;
  onOpen: (p: Project) => void;
  onLaunch: (p: Project) => void;
  onToggleMilestone: (p: Project, phaseId: string, msId: string, done: boolean) => void;
  /** Nieuwe volgorde van álle projecten, als lijst van keys (index = rang). */
  onReorder: (keys: string[]) => void;
  onGitInit: (path: string) => void;
  onIgnore: (path: string) => void;
  onOpenPath: (path: string) => void;
  onGoSettings: () => void;
  /** Nachtelijke runs die je nog niet hebt bekeken; voedt de ochtendbanner. */
  nightlyUnseen?: NightlyRun[];
  onOpenNightly?: () => void;
}

export default function Dashboard({
  projects,
  claudeByKey,
  noGit,
  machineName,
  pcCount,
  scanning,
  theme,
  hasRoots,
  onToggleTheme,
  onScan,
  onOpen,
  onLaunch,
  onToggleMilestone,
  onReorder,
  onGitInit,
  onIgnore,
  onOpenPath,
  onGoSettings,
  nightlyUnseen = [],
  onOpenNightly,
}: Props) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("alle");
  const [sort, setSort] = useState<Sort>("recent");
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = projects.filter((p) => {
      if (filter !== "alle" && statusOf(p) !== filter) return false;
      if (!q) return true;
      const inName = p.name.toLowerCase().includes(q);
      const inStack = effectiveStack(p).some((t) => t.toLowerCase().includes(q));
      const inBranch = p.states.some((s) => (s.branch ?? "").toLowerCase().includes(q));
      return inName || inStack || inBranch;
    });
    list = [...list].sort((a, b) => {
      if (sort === "naam") return a.name.localeCompare(b.name);
      if (sort === "eigen") return byRank(a, b);
      return lastActivity(b) - lastActivity(a);
    });
    return list;
  }, [projects, query, filter, sort]);

  // Slepen kan alleen in "Eigen volgorde": in de andere standen zou een
  // versleepte kaart meteen terugspringen naar zijn gesorteerde plek.
  const canReorder = sort === "eigen";

  function handleDrop(targetKey: string) {
    if (!dragKey || dragKey === targetKey) return;
    onReorder(reorderProjects(projects, dragKey, targetKey));
    setDragKey(null);
    setOverKey(null);
  }

  const activeCount = projects.filter((p) => statusOf(p) === "actief").length;

  return (
    <main className="main">
      <div className="top">
        <div>
          <h1>Overzicht</h1>
          <div className="sub">
            {projects.length} projecten · {pcCount} PC{pcCount === 1 ? "" : "'s"} · {activeCount} actief
          </div>
        </div>
        <div className="search">
          <span>⌕</span>
          <input
            placeholder="Zoek project, stack of branch…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button className="toggle" title="Wissel licht/donker" onClick={onToggleTheme}>
          {theme === "dark" ? "☀" : "☾"}
        </button>
        <button className="btn" onClick={onScan} disabled={scanning || !hasRoots}>
          {scanning ? "Scannen…" : "↻ Scannen"}
        </button>
      </div>

      {nightlyUnseen.length > 0 && onOpenNightly && (
        // Het ochtendoverzicht hoort je te vinden, niet andersom: zolang je de
        // runs van vannacht nog niet gezien hebt, staat het hier.
        <div className="banner nightly">
          <div className="next-step-content">
            <div className="next-step-phase">Vannacht</div>
            <div className="next-step-text">
              {nightlyUnseen.length} {nightlyUnseen.length === 1 ? "prompt" : "prompts"} opgepakt ·{" "}
              {summaryText(summarize(nightlyUnseen))}
            </div>
          </div>
          <button className="btn" onClick={onOpenNightly}>
            ☾ Bekijken
          </button>
        </div>
      )}

      {!hasRoots ? (
        <div className="empty">
          <div className="big">▦</div>
          <h2>Nog geen root-map ingesteld</h2>
          <p>
            Voeg een map toe (bijv. <code>~/programms</code>) waarin Projectradar je
            git-projecten op deze PC ({machineName}) automatisch vindt en uitleest.
          </p>
          <button className="btn" onClick={onGoSettings}>
            + Root-map toevoegen
          </button>
        </div>
      ) : (
        <>
          <div className="filters">
            {FILTERS.map((f) => (
              <button
                type="button"
                key={f.key}
                className={`chip${filter === f.key ? " on" : ""}`}
                aria-pressed={filter === f.key}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
            <button
              type="button"
              className="chip"
              style={{ marginLeft: "auto" }}
              onClick={() => setSort(SORT_CYCLE[sort])}
            >
              Sorteer: {SORT_LABEL[sort]} ▾
            </button>
          </div>

          {canReorder && visible.length > 1 && (
            <p className="hint drag-hint">Sleep kaarten om je eigen volgorde te bepalen.</p>
          )}

          {scanning && projects.length === 0 ? (
            <div className="grid">
              {Array.from({ length: 6 }, (_, i) => (
                <div className="card skel-card" key={i} aria-hidden>
                  <div className="skel-head">
                    <div className="skel w-55" />
                    <div className="skel w-20" />
                  </div>
                  <div className="skel w-90 mt-10" />
                  <div className="skel w-70 mt-6" />
                  <div className="skel-tags">
                    <div className="skel w-18" />
                    <div className="skel w-22" />
                  </div>
                  <div className="skel w-100 mt-14" style={{ height: 6, borderRadius: 99 }} />
                  <div className="skel-meta">
                    <div className="skel w-30" />
                    <div className="skel w-25" />
                  </div>
                </div>
              ))}
            </div>
          ) : visible.length === 0 ? (
            <div className="empty">
              <h2>Geen projecten gevonden</h2>
              <p>Pas je zoekopdracht of filter aan, of scan opnieuw.</p>
            </div>
          ) : (
            <div className="grid">
              {visible.map((p) => (
                <div
                  key={p.key}
                  className={`drag-wrap${canReorder ? " on" : ""}${dragKey === p.key ? " dragging" : ""}${overKey === p.key && dragKey !== p.key ? " over" : ""}`}
                  draggable={canReorder}
                  onDragStart={() => setDragKey(p.key)}
                  onDragEnd={() => { setDragKey(null); setOverKey(null); }}
                  onDragOver={(e) => {
                    if (!canReorder || !dragKey) return;
                    e.preventDefault(); // zonder dit vuurt onDrop niet
                    if (overKey !== p.key) setOverKey(p.key);
                  }}
                  onDrop={(e) => { e.preventDefault(); handleDrop(p.key); }}
                >
                  <ProjectCard
                    project={p}
                    claudeState={claudeByKey[p.key] ?? null}
                    onOpen={onOpen}
                    onLaunch={onLaunch}
                    onToggleMilestone={onToggleMilestone}
                  />
                </div>
              ))}
            </div>
          )}

          {noGit.length > 0 && (
            <>
              <div className="section-h">
                <h2>Nog geen git</h2>
                <span className="count">
                  {noGit.length} {noGit.length === 1 ? "map" : "mappen"}
                </span>
              </div>
              <div className="nogit">
                {noGit.map((f) => (
                  <div className="card" key={f.path}>
                    <div className="head">
                      <h3>{f.name}</h3>
                    </div>
                    <div className="path">{f.path}</div>
                    <div className="actions">
                      <button className="mini pri" onClick={() => onGitInit(f.path)}>
                        git init
                      </button>
                      <button className="mini" onClick={() => onOpenPath(f.path)}>
                        Open map
                      </button>
                      <button className="mini" onClick={() => onIgnore(f.path)}>
                        Negeren
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </main>
  );
}
