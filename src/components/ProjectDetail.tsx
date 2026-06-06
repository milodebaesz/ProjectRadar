import { useState } from "react";
import type { ClaudeState, Project, ProjectMeta, Status, Phase } from "../types";
import ClaudeBadge from "./ClaudeBadge";
import { STATUS_LABEL } from "../types";
import { compareStates, effectiveStack, roadmapProgress, localPath, runCommandOf, devUrlOf } from "../lib/model";
import { relativeTime, uid } from "../lib/format";
import { isGithubRemote } from "../lib/github";
import DeleteDialog, { type DeleteOptions } from "./DeleteDialog";

const STATUSES: Status[] = ["idee", "actief", "onhold", "afgerond"];

interface Props {
  project: Project;
  claudeState: ClaudeState | null;
  hasGithubToken: boolean;
  onBack: () => void;
  onSave: (meta: ProjectMeta) => void;
  onOpenPath: (target: string) => void;
  onLaunch: (p: Project) => void;
  onClaude: (p: Project, instruction: string) => void;
  onDelete: (p: Project, opts: DeleteOptions) => Promise<void>;
}

export default function ProjectDetail({ project, claudeState, hasGithubToken, onBack, onSave, onOpenPath, onLaunch, onClaude, onDelete }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [claudeInput, setClaudeInput] = useState("");
  const [meta, setMeta] = useState<ProjectMeta>({
    ...project.meta,
    key: project.key,
  });
  const cmp = compareStates(project);

  function update(patch: Partial<ProjectMeta>) {
    const next = { ...meta, ...patch };
    setMeta(next);
    onSave(next);
  }

  // ── Roadmap-bewerkingen ──
  const phases = meta.roadmap ?? [];
  function setPhases(next: Phase[]) {
    update({ roadmap: next });
  }
  function addPhase() {
    setPhases([...phases, { id: uid(), name: "Nieuwe fase", milestones: [] }]);
  }
  function updatePhase(id: string, patch: Partial<Phase>) {
    setPhases(phases.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }
  function removePhase(id: string) {
    setPhases(phases.filter((p) => p.id !== id));
  }
  function addMilestone(phaseId: string) {
    setPhases(
      phases.map((p) =>
        p.id === phaseId
          ? { ...p, milestones: [...p.milestones, { id: uid(), text: "Nieuwe mijlpaal", done: false }] }
          : p,
      ),
    );
  }
  function updateMilestone(phaseId: string, msId: string, patch: Partial<{ text: string; done: boolean }>) {
    setPhases(
      phases.map((p) =>
        p.id === phaseId
          ? { ...p, milestones: p.milestones.map((m) => (m.id === msId ? { ...m, ...patch } : m)) }
          : p,
      ),
    );
  }
  function removeMilestone(phaseId: string, msId: string) {
    setPhases(
      phases.map((p) =>
        p.id === phaseId ? { ...p, milestones: p.milestones.filter((m) => m.id !== msId) } : p,
      ),
    );
  }

  const stackValue = (meta.stack ?? effectiveStack(project)).join(", ");
  const repoLink = meta.links?.repo || project.remoteUrl || "";
  const deployLink = meta.links?.deploy || "";
  const progress = roadmapProgress(project);
  const canLaunch = !!localPath(project);
  const runCommand = runCommandOf({ ...project, meta });
  const devUrl = devUrlOf({ ...project, meta });

  return (
    <main className="main">
      <button className="back" onClick={onBack}>
        ← Terug naar overzicht
      </button>

      <div className="detail-head">
        <div>
          <h1>{project.name}</h1>
          <div className="sub">{project.states.length} PC{project.states.length === 1 ? "" : "'s"}</div>
        </div>
        <div className="head-right">
          <ClaudeBadge state={claudeState} />
          {canLaunch && (
            <button className="launch" title={`Start: ${runCommand}`} onClick={() => onLaunch(project)}>
              ▶ Start
            </button>
          )}
          <select
            className="badge"
            value={meta.status ?? "idee"}
            onChange={(e) => update({ status: e.target.value as Status })}
            style={{ padding: "7px 12px", borderRadius: 9, border: "1px solid var(--line)", background: "var(--bg-2)", color: "var(--txt)" }}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!cmp.inSync && cmp.message && (
        <div className="banner info">⚠ {cmp.message}</div>
      )}

      <div className="panel">
        <h2>Doel &amp; beschrijving</h2>
        <div className="field">
          <textarea
            placeholder="Waar gaat dit project over? Wat wil je ermee bereiken?"
            value={meta.description ?? ""}
            onChange={(e) => update({ description: e.target.value })}
          />
        </div>
        <div className="field">
          <label>Stack / taal (komma-gescheiden)</label>
          <input
            value={stackValue}
            onChange={(e) => {
              const arr = e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
              update({ stack: arr.length ? arr : undefined });
            }}
          />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Links</label>
          <div style={{ display: "grid", gap: 8 }}>
            <input
              placeholder="Repo-URL"
              value={repoLink}
              onChange={(e) => update({ links: { ...meta.links, repo: e.target.value } })}
            />
            <input
              placeholder="Deploy-URL"
              value={deployLink}
              onChange={(e) => update({ links: { ...meta.links, deploy: e.target.value } })}
            />
          </div>
        </div>
        <div className="field" style={{ marginBottom: 0, marginTop: 14 }}>
          <label>Start-commando (dev-server)</label>
          <input
            placeholder={project.defaultRunCommand || "npm run dev"}
            value={meta.runCommand ?? ""}
            onChange={(e) => update({ runCommand: e.target.value || undefined })}
            style={{ fontFamily: "var(--mono)" }}
          />
          <p className="hint" style={{ marginTop: 6, marginBottom: 0 }}>
            {canLaunch
              ? `Wordt in een terminal gedraaid in de projectmap. Nu: ${runCommand}`
              : "Dit project staat niet op deze PC, dus launchen kan hier niet."}
          </p>
        </div>
        <div className="field" style={{ marginBottom: 0, marginTop: 14 }}>
          <label>Dev-URL (browser openen na start)</label>
          <input
            placeholder={project.defaultDevUrl || "bijv. http://localhost:5173 — leeg = geen browser"}
            value={meta.devUrl ?? ""}
            onChange={(e) => update({ devUrl: e.target.value || undefined })}
            style={{ fontFamily: "var(--mono)" }}
          />
          <p className="hint" style={{ marginTop: 6, marginBottom: 0 }}>
            {devUrl
              ? `Na het starten wachten we tot de server luistert en openen dan ${devUrl} in Chrome.`
              : "Geen URL ingesteld of gedetecteerd — er wordt geen browser geopend."}
          </p>
          <div className="link-row">
            {repoLink && (
              <span className="link-pill" onClick={() => onOpenPath(repoLink)}>
                ↗ Repo
              </span>
            )}
            {deployLink && (
              <span className="link-pill" onClick={() => onOpenPath(deployLink)}>
                ↗ Deploy
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="panel">
        <h2>Per PC</h2>
        <p className="hint">Branch en laatste commit per machine waar dit project staat.</p>
        <div className="pc-block">
          {project.states.map((s) => (
            <div className="pc-row" key={s.machine}>
              <span className="name">{s.machine}</span>
              <span className="br">{s.branch ?? "—"}</span>
              {s.ahead > 0 && <span style={{ color: "var(--ahead)" }}>▲{s.ahead}</span>}
              {s.behind > 0 && <span style={{ color: "var(--behind)" }}>▼{s.behind}</span>}
              {s.hasUncommitted && <span style={{ color: "var(--warn)" }}>● niet-gecommit</span>}
              <span className="when">
                {s.totalCommits > 0 ? relativeTime(s.lastCommitDate) : "geen commits"}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ display: "flex", alignItems: "center", gap: 10 }}>
            Roadmap
            {progress && (
              <span className="pct" style={{ fontSize: 13 }}>
                {progress.pct}% · {progress.done}/{progress.total}
              </span>
            )}
          </h2>
          <button className="mini pri" onClick={addPhase}>
            + Fase
          </button>
        </div>
        <p className="hint">Fasen met afvinkbare mijlpalen en een optionele streefdatum.</p>

        {phases.length === 0 && (
          <p className="hint" style={{ marginBottom: 0 }}>Nog geen fasen. Voeg er een toe om te beginnen.</p>
        )}

        {phases.map((ph) => {
          const done = ph.milestones.filter((m) => m.done).length;
          return (
            <div className="roadmap-phase" key={ph.id}>
              <div className="ph-head">
                <input
                  className="ph-name"
                  value={ph.name}
                  onChange={(e) => updatePhase(ph.id, { name: e.target.value })}
                />
                <span className="count">
                  {done}/{ph.milestones.length}
                </span>
                <input
                  placeholder="streefdatum"
                  value={ph.target ?? ""}
                  onChange={(e) => updatePhase(ph.id, { target: e.target.value })}
                  style={{ width: 120, fontSize: 12, background: "var(--bg-2)", border: "1px solid var(--line)", borderRadius: 8, padding: "5px 9px", color: "var(--txt-dim)" }}
                />
                <button className="rm" onClick={() => removePhase(ph.id)} title="Fase verwijderen">
                  ✕
                </button>
              </div>
              {ph.milestones.map((m) => (
                <div className={`milestone${m.done ? " done" : ""}`} key={m.id}>
                  <input
                    type="checkbox"
                    checked={m.done}
                    onChange={(e) => updateMilestone(ph.id, m.id, { done: e.target.checked })}
                  />
                  <input
                    className="ms-text"
                    value={m.text}
                    onChange={(e) => updateMilestone(ph.id, m.id, { text: e.target.value })}
                  />
                  {!m.done && canLaunch && (
                    <button
                      className="ms-claude"
                      title="Laat Claude deze mijlpaal oppakken"
                      onClick={() =>
                        onClaude(project, `Werk deze mijlpaal uit: ${m.text}`)
                      }
                    >
                      ✦ Claude
                    </button>
                  )}
                  <button className="rm" onClick={() => removeMilestone(ph.id, m.id)}>
                    ✕
                  </button>
                </div>
              ))}
              <button className="mini" style={{ marginTop: 8 }} onClick={() => addMilestone(ph.id)}>
                + Mijlpaal
              </button>
            </div>
          );
        })}
      </div>

      <div className="panel">
        <h2 style={{ display: "flex", alignItems: "center", gap: 10 }}>
          Doorwerken met Claude
          <ClaudeBadge state={claudeState} />
        </h2>
        <p className="hint">
          Opent Claude Code in de projectmap met je instructie + de huidige roadmap
          als context. Laat leeg om de eerstvolgende openstaande mijlpaal te laten
          oppakken.
        </p>
        <div className="field" style={{ marginBottom: 12 }}>
          <textarea
            placeholder="Bijv. 'Werk fase 2 af' of 'Implementeer de login-flow en vink de mijlpaal af'…"
            value={claudeInput}
            onChange={(e) => setClaudeInput(e.target.value)}
          />
        </div>
        <button
          className="btn"
          disabled={!canLaunch}
          onClick={() => {
            onClaude(project, claudeInput);
            setClaudeInput("");
          }}
          title={canLaunch ? "Open Claude Code" : "Project staat niet op deze PC"}
        >
          ✦ Open in Claude
        </button>
        {!canLaunch && (
          <p className="hint" style={{ marginTop: 8, marginBottom: 0 }}>
            Dit project staat niet op deze PC.
          </p>
        )}
      </div>

      <div className="panel danger-zone">
        <h2>Verwijderen</h2>
        <p className="hint">
          Haal dit project uit het overzicht — optioneel ook de lokale map (naar de
          prullenbak) en de GitHub-repo.
        </p>
        <button className="btn danger" onClick={() => setConfirming(true)}>
          Project verwijderen…
        </button>
      </div>

      {confirming && (
        <DeleteDialog
          project={project}
          localPath={localPath(project)}
          isGithub={isGithubRemote(project.remoteUrl)}
          hasToken={hasGithubToken}
          onCancel={() => setConfirming(false)}
          onConfirm={async (opts) => {
            await onDelete(project, opts);
            setConfirming(false);
          }}
        />
      )}
    </main>
  );
}
