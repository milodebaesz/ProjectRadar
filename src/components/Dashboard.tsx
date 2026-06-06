import { useMemo, useState } from "react";
import type { ClaudeState, NoGitFolder, Project, Status } from "../types";
import { effectiveStack, statusOf } from "../lib/model";
import ProjectCard from "./ProjectCard";

type Filter = "alle" | Status;
type Sort = "recent" | "naam";

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
  onGitInit: (path: string) => void;
  onIgnore: (path: string) => void;
  onOpenPath: (path: string) => void;
  onGoSettings: () => void;
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
  onGitInit,
  onIgnore,
  onOpenPath,
  onGoSettings,
}: Props) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("alle");
  const [sort, setSort] = useState<Sort>("recent");

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
    list = [...list].sort((a, b) =>
      sort === "naam"
        ? a.name.localeCompare(b.name)
        : lastActivity(b) - lastActivity(a),
    );
    return list;
  }, [projects, query, filter, sort]);

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
              <span
                key={f.key}
                className={`chip${filter === f.key ? " on" : ""}`}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
              </span>
            ))}
            <span
              className="chip"
              style={{ marginLeft: "auto" }}
              onClick={() => setSort(sort === "recent" ? "naam" : "recent")}
            >
              Sorteer: {sort === "recent" ? "Laatst gewijzigd" : "Naam"} ▾
            </span>
          </div>

          {visible.length === 0 ? (
            <div className="empty">
              <h2>Geen projecten gevonden</h2>
              <p>Pas je zoekopdracht of filter aan, of scan opnieuw.</p>
            </div>
          ) : (
            <div className="grid">
              {visible.map((p) => (
                <ProjectCard
                  key={p.key}
                  project={p}
                  claudeState={claudeByKey[p.key] ?? null}
                  onOpen={onOpen}
                  onLaunch={onLaunch}
                />
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
