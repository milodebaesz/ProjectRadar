import type { ClaudeState, Project } from "../types";
import { STATUS_LABEL } from "../types";
import ClaudeBadge from "./ClaudeBadge";
import {
  effectiveStack,
  statusOf,
  compareStates,
  roadmapProgress,
  localPath,
  nextOpenPhase,
  driftDays,
  runCommandOf,
  hasManualStatus,
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
  onToggleMilestone,
}: {
  project: Project;
  claudeState: ClaudeState | null;
  onOpen: (p: Project) => void;
  onLaunch: (p: Project) => void;
  onToggleMilestone: (p: Project, phaseId: string, msId: string, done: boolean) => void;
}) {
  const status = statusOf(project);
  const stack = effectiveStack(project);
  const cmp = compareStates(project);
  const progress = roadmapProgress(project);
  const startCommand = runCommandOf(project);
  const canRun = !!localPath(project) && !!startCommand;
  const autoStatus = !hasManualStatus(project);
  // Met één machine vergelijkt de PC-regel niets: de naam is altijd deze PC en
  // de schoon/vuil-stip staat al in de git-regel eronder. Alleen ahead/behind
  // is dan nieuw, en dat verhuist naar die git-regel.
  const multiPc = project.states.length > 1;
  const next = nextOpenPhase(project.meta.roadmap ?? []);
  const drift = driftDays(project);
  const nextMilestone = next?.milestones[0] ?? null;
  // De stand op deze PC (lokaal is er precies één).
  const primary =
    project.states.find((s) => s.isThisPc) ?? project.states[0];

  return (
    // De kaart bevat zelf knoppen, dus hij kan geen <button> zijn. In plaats
    // daarvan is de titel de echte knop, en rekt die zich via ::after uit over
    // het hele kaartvlak — muisklik overal, tab-stop precies één, en een
    // voorleesbare naam in plaats van de complete kaartinhoud.
    <div className="card">
      <div className="head">
        <h3>
          <button type="button" className="card-open" onClick={() => onOpen(project)}>
            {project.name}
          </button>
        </h3>
        <div className="head-right">
          <ClaudeBadge state={claudeState} />
          {canRun && (
            <button className="launch" title={`Start de dev-server: ${startCommand}`} onClick={() => onLaunch(project)}>
              ▶ Start
            </button>
          )}
          <span
            className={`badge ${BADGE_CLASS[status]}${autoStatus ? " auto" : ""}`}
            title={
              autoStatus
                ? "Afgeleid uit de git-activiteit — kies zelf een status in het project om dit vast te zetten"
                : undefined
            }
          >
            {STATUS_LABEL[status]}
          </span>
        </div>
      </div>
      {/* Geen placeholder bij een lege beschrijving: op een dashboard vol
          ongevulde projecten was "Nog geen beschrijving." de meest gelezen
          regel van het scherm, en hij zei niets. */}
      {project.meta.description && <div className="desc">{project.meta.description}</div>}

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

      {nextMilestone && next && (
        <label className="next-milestone" title="Direct afvinken zonder het project te openen">
          <input
            type="checkbox"
            checked={false}
            onChange={(e) => onToggleMilestone(project, next.phase.id, nextMilestone.id, e.target.checked)}
          />
          <span>{nextMilestone.text}</span>
        </label>
      )}

      {multiPc && (
        <div className="pcs">
          <span className="lbl">Op:</span>
          {project.states.map((s) => {
            const lead = cmp.leadMachine === s.machine;
            return (
              <span className={`pcbadge${lead ? " lead" : ""}`} key={s.machine}>
                {s.machine}
                {s.ahead > 0 && <span className="ah">▲{s.ahead}</span>}
                {s.behind > 0 && <span className="bh">▼{s.behind}</span>}
                {s.hasUncommitted ? (
                  <span className="dirty" title="niet-gecommitte wijzigingen">●</span>
                ) : (
                  <span className="cln" title="schoon">●</span>
                )}
              </span>
            );
          })}
        </div>
      )}

      {!cmp.inSync && cmp.message && <div className="diverge">⚠ {cmp.message}</div>}

      {drift !== null && (
        <div className="drifting" title={`Status staat op "actief", maar de laatste commit is ${drift} dagen oud`}>
          ⧗ {drift} dagen stil — nog steeds actief?
        </div>
      )}

      {primary && (
        <div className="meta">
          {primary.totalCommits > 0 ? (
            <>
              <span className="git">{primary.branch ?? "—"}</span>
              {!multiPc && primary.ahead > 0 && (
                <span className="ah" title={`${primary.ahead} commits voor op de remote`}>
                  ▲{primary.ahead}
                </span>
              )}
              {!multiPc && primary.behind > 0 && (
                <span className="bh" title={`${primary.behind} commits achter op de remote`}>
                  ▼{primary.behind}
                </span>
              )}
              <span>· {relativeTime(primary.lastCommitDate)}</span>
              {primary.hasUncommitted ? (
                <span className="changes">● niet-gecommit</span>
              ) : (
                <span className="clean">● schoon</span>
              )}
              {primary.weeklyCommits > 0 && (
                <span className="weekly" title="Commits in de afgelopen 7 dagen">
                  🔥 {primary.weeklyCommits} deze week
                </span>
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
