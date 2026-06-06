import type { ClaudeState, Project } from "../types";
import { STATUS_LABEL } from "../types";
import ClaudeBadge from "./ClaudeBadge";
import {
  effectiveStack,
  statusOf,
  compareStates,
  roadmapProgress,
  localPath,
} from "../lib/model";
import { relativeTime } from "../lib/format";

/** Hoeveel stack-tags we maximaal op de overzichtskaart tonen. */
const MAX_STACK = 2;

const BADGE_CLASS: Record<string, string> = {
  idee: "b-idee",
  actief: "b-actief",
  onhold: "b-onhold",
  afgerond: "b-afgerond",
};

export default function ProjectCard({
  project,
  claudeState,
  onOpen,
  onLaunch,
}: {
  project: Project;
  claudeState: ClaudeState | null;
  onOpen: (p: Project) => void;
  onLaunch: (p: Project) => void;
}) {
  const status = statusOf(project);
  const stack = effectiveStack(project);
  const cmp = compareStates(project);
  const progress = roadmapProgress(project);
  const canLaunch = !!localPath(project);
  // De stand op deze PC (lokaal is er precies één).
  const primary =
    project.states.find((s) => s.isThisPc) ?? project.states[0];

  return (
    <div className="card" onClick={() => onOpen(project)}>
      <div className="head">
        <h3>{project.name}</h3>
        <div className="head-right">
          <ClaudeBadge state={claudeState} />
          {canLaunch && (
            <button
              className="launch"
              title="Start de dev-server"
              onClick={(e) => {
                e.stopPropagation();
                onLaunch(project);
              }}
            >
              ▶ Start
            </button>
          )}
          <span className={`badge ${BADGE_CLASS[status]}`}>{STATUS_LABEL[status]}</span>
        </div>
      </div>
      <div className="desc">
        {project.meta.description || <span style={{ color: "var(--txt-faint)" }}>Nog geen beschrijving.</span>}
      </div>

      {stack.length > 0 && (
        <div className="stack">
          {stack.slice(0, MAX_STACK).map((t) => (
            <span className="tag" key={t}>
              {t}
            </span>
          ))}
          {stack.length > MAX_STACK && (
            <span className="tag more">+{stack.length - MAX_STACK}</span>
          )}
        </div>
      )}

      {progress && (
        <div className="progress" title={`${progress.done}/${progress.total} mijlpalen`}>
          <div className="progress-head">
            <span>Roadmap</span>
            <span className="pct">{progress.pct}%</span>
          </div>
          <div className="bar">
            <div className="fill" style={{ width: `${progress.pct}%` }} />
          </div>
        </div>
      )}

      {project.states.length > 0 && (
        <div className="pcs">
          <span className="lbl">Op:</span>
          {project.states.map((s) => {
            const lead = cmp.leadMachine === s.machine;
            return (
              <span className={`pcbadge${lead ? " lead" : ""}`} key={s.machine}>
                {s.machine}
                {s.ahead > 0 && <span className="ah">▲{s.ahead}</span>}
                {s.behind > 0 && <span className="bh">▼{s.behind}</span>}
              </span>
            );
          })}
        </div>
      )}

      {!cmp.inSync && cmp.message && <div className="diverge">⚠ {cmp.message}</div>}

      {primary && (
        <div className="meta">
          {primary.totalCommits > 0 ? (
            <>
              <span className="git">{primary.branch ?? "—"}</span>
              <span>· {relativeTime(primary.lastCommitDate)}</span>
              {primary.hasUncommitted ? (
                <span className="changes">● niet-gecommit</span>
              ) : (
                <span className="clean">● schoon</span>
              )}
            </>
          ) : (
            <>
              <span className="git">— geen commits</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
