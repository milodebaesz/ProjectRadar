import { useEffect, useState } from "react";
import type { ClaudeState, Project, ProjectMeta, Status, Phase } from "../types";
import ClaudeBadge from "./ClaudeBadge";
import { STATUS_LABEL } from "../types";
import { compareStates, effectiveStack, roadmapProgress, localPath, runCommandOf, devUrlOf, buildRoadmapInstruction, nextOpenPhase, buildPickUpPrompt, buildCodeCheckInstruction, buildDesignCheckInstruction, buildScheduleEntry, scheduleIdOf, dedupeRoadmap, normalizeRoadmap, refreshRoadmapFromFile } from "../lib/model";
import { readRadarFile } from "../lib/tauri";
import { relativeTime, uid } from "../lib/format";
import { isGithubRemote } from "../lib/github";
import DeleteDialog, { type DeleteOptions } from "./DeleteDialog";
import ClaudeInstructionsModal from "./ClaudeInstructionsModal";
import SchedulePicker from "./SchedulePicker";
import CollapsiblePanel from "./CollapsiblePanel";
import { scheduleSet, scheduleClear } from "../lib/tauri";
import { loadPanelCollapsed, savePanelCollapsed } from "../lib/storage";

const STATUSES: Status[] = ["idee", "actief", "onhold", "afgerond"];

interface Props {
  project: Project;
  claudeState: ClaudeState | null;
  hasGithubToken: boolean;
  onBack: () => void;
  onSave: (meta: ProjectMeta) => void;
  onOpenPath: (target: string) => void;
  onLaunch: (p: Project) => void;
  onClaude: (p: Project, instruction: string, label?: string) => void;
  onDelete: (p: Project, opts: DeleteOptions) => Promise<void>;
}

export default function ProjectDetail({ project, claudeState, hasGithubToken, onBack, onSave, onOpenPath, onLaunch, onClaude, onDelete }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [claudeInput, setClaudeInput] = useState("");
  const [editingInstructions, setEditingInstructions] = useState(false);
  const [editingDesignInstructions, setEditingDesignInstructions] = useState(false);
  const [hideCompleted, setHideCompleted] = useState(() => loadPanelCollapsed(`${project.key}:roadmap-hide-done`, false));
  const [meta, setMeta] = useState<ProjectMeta>({
    ...project.meta,
    key: project.key,
  });
  // Herlaad de lokale kopie zodra de projectdata van buitenaf verandert (na een
  // rescan, een geplande run die klaar is, of het afvinken van een mijlpaal
  // vanaf het dashboard) — anders bleef hier de roadmap-stand van het moment
  // van openen staan, ook als er ondertussen alweer nieuwe data binnenkwam.
  // Ruimt meteen dubbele fasen/mijlpalen op (zie `dedupeRoadmap`) en
  // persisteert die opschoning, zodat een al opgezwollen roadmap zichzelf
  // herstelt zodra je het project opent.
  useEffect(() => {
    const original = project.meta.roadmap ?? [];
    const cleaned = dedupeRoadmap(original);
    const next = { ...project.meta, key: project.key, roadmap: cleaned };
    setMeta(next);
    const changed =
      cleaned.length !== original.length ||
      cleaned.some((ph, i) => ph.milestones.length !== (original[i]?.milestones.length ?? -1));
    if (changed) onSave(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project]);
  const cmp = compareStates(project);
  const pid = (panel: string) => `${project.key}:${panel}`;

  function update(patch: Partial<ProjectMeta>) {
    const next = { ...meta, ...patch };
    setMeta(next);
    onSave(next);
  }

  // ── Roadmap-bewerkingen ──
  const phases = meta.roadmap ?? [];

  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);

  /**
   * Haalt de roadmap opnieuw uit `.projectradar.json`. Nodig omdat de
   * automatische samenvoeging bij een scan (`reconcileRoadmap`) bewust de
   * cache laat winnen op structuur: een door Claude hernoemde fase of een
   * opgeruimde mijlpaal komt daardoor niet vanzelf door. Deze knop draait
   * `refreshRoadmapFromFile`, waarin het bestand de structuur bepaalt.
   */
  async function refreshFromFile() {
    const path = localPath(project);
    if (!path) {
      setRefreshMsg("Dit project staat niet op deze PC.");
      return;
    }
    setRefreshing(true);
    setRefreshMsg(null);
    try {
      const file = await readRadarFile(path);
      if (!file) {
        setRefreshMsg("Geen .projectradar.json in de projectmap.");
        return;
      }
      if (!Array.isArray(file.roadmap) || file.roadmap.length === 0) {
        setRefreshMsg("Het bestand bevat geen roadmap.");
        return;
      }
      const next = refreshRoadmapFromFile(phases, normalizeRoadmap(file.roadmap as unknown[]));
      update({ roadmap: next });
      const total = next.reduce((n, ph) => n + ph.milestones.length, 0);
      setRefreshMsg(`Ververst: ${next.length} ${next.length === 1 ? "fase" : "fasen"}, ${total} ${total === 1 ? "mijlpaal" : "mijlpalen"}.`);
    } catch (e) {
      setRefreshMsg(`Verversen mislukt: ${e}`);
    } finally {
      setRefreshing(false);
    }
  }
  function setPhases(next: Phase[]) {
    // Houd de autonome Rust-scheduler in sync: elke fase met een scheduledAt
    // wordt (opnieuw) gepusht, en fasen die hun schedule kwijtraakten (of
    // verwijderd zijn) worden daar ook gewist. Zo blijft de geplande run
    // draaien ongeacht of ProjectRadar open/zichtbaar is — zie schedule.rs.
    for (const ph of phases) {
      const stillScheduled = next.find((p) => p.id === ph.id)?.scheduledAt;
      if (ph.scheduledAt && !stillScheduled) {
        scheduleClear(scheduleIdOf(project.key, ph.id)).catch(() => {});
      }
    }
    if (localPath(project)) {
      for (const ph of next) {
        if (!ph.scheduledAt) continue;
        // Een allang verstreken scheduledAt nooit opnieuw bewapenen — dat was
        // precies de oneindige-lus-bug (zie useScheduledRuns.ts): een fase die
        // ooit is afgevuurd maar z'n scheduledAt nooit kwijtraakte, werd bij
        // elke roadmap-wijziging weer naar Rust gepusht en telkens opnieuw
        // afgevuurd.
        const at = new Date(ph.scheduledAt).getTime();
        if (!Number.isNaN(at) && Date.now() - at > 5 * 60_000) continue;
        const entry = buildScheduleEntry({ ...project, meta: { ...meta, roadmap: next } }, ph);
        if (entry) scheduleSet(entry).catch(() => {});
      }
    }
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

  function toggleHideCompleted() {
    const next = !hideCompleted;
    setHideCompleted(next);
    savePanelCollapsed(`${project.key}:roadmap-hide-done`, next);
  }

  // Bij "verberg afgevinkte": een fase met minstens één mijlpaal die allemaal
  // klaar zijn, valt helemaal weg; binnen een nog zichtbare fase blijven alleen
  // de openstaande mijlpalen staan.
  const visiblePhases = hideCompleted
    ? phases.filter((ph) => ph.milestones.length === 0 || ph.milestones.some((m) => !m.done))
    : phases;
  const hiddenPhaseCount = phases.length - visiblePhases.length;
  const hiddenMilestoneCount = hideCompleted
    ? visiblePhases.reduce((n, ph) => n + ph.milestones.filter((m) => m.done).length, 0)
    : 0;

  const nextStep = nextOpenPhase(phases);

  const stackValue = (meta.stack ?? effectiveStack(project)).join(", ");
  const repoLink = meta.links?.repo || project.remoteUrl || "";
  const deployLink = meta.links?.deploy || "";
  const progress = roadmapProgress(project);
  const canLaunch = !!localPath(project);
  const runCommand = runCommandOf({ ...project, meta });
  const devUrl = devUrlOf({ ...project, meta });

  const lastRun = meta.history?.[0];
  const pcSummary = `${project.states.length} PC${project.states.length === 1 ? "" : "'s"}${cmp.inSync ? " · in sync" : " · loopt uiteen"}`;

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

      {canLaunch && nextStep && (
        <div className="banner next-step">
          <div className="next-step-content">
            <div className="next-step-phase">{nextStep.phase.name}</div>
            <div className="next-step-text">
              {nextStep.milestones.length === 1
                ? nextStep.milestones[0].text
                : `${nextStep.milestones.length} openstaande mijlpalen — ${nextStep.milestones[0].text}…`}
            </div>
          </div>
          <button
            className="btn"
            onClick={() =>
              onClaude(
                { ...project, meta },
                buildPickUpPrompt({ ...project, meta }),
                `Sprint opgepakt: ${nextStep.phase.name}`,
              )
            }
            title="Werkt de hele fase (sprint) af, inclusief alle openstaande mijlpalen"
          >
            ✦ Pak de sprint op
          </button>
        </div>
      )}

      <div className="detail-grid">
        <CollapsiblePanel id={pid("doel")} title="Doel & beschrijving" summary={meta.description?.trim() || "Geen beschrijving"}>
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
                <button type="button" className="link-pill" onClick={() => onOpenPath(repoLink)}>
                  ↗ Repo
                </button>
              )}
              {deployLink && (
                <button type="button" className="link-pill" onClick={() => onOpenPath(deployLink)}>
                  ↗ Deploy
                </button>
              )}
            </div>
          </div>
        </CollapsiblePanel>

        <CollapsiblePanel id={pid("pc")} title="Per PC" summary={pcSummary}>
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
        </CollapsiblePanel>

        <CollapsiblePanel
          id={pid("roadmap")}
          className="span-full"
          title="Roadmap"
          summary={progress ? `${progress.pct}% · ${progress.done}/${progress.total}` : "Nog geen fasen"}
          actions={
            progress && (
              <span className="pct" style={{ fontSize: 13 }}>
                {progress.pct}% · {progress.done}/{progress.total}
              </span>
            )
          }
        >
          <p className="hint">Fasen met afvinkbare mijlpalen en een optionele streefdatum.</p>

          <div className="toolbar">
            {canLaunch && (
              <button
                className="mini pri"
                title="Opent Claude Code om de roadmap te laten genereren of checken"
                onClick={() =>
                  onClaude(
                    { ...project, meta },
                    buildRoadmapInstruction({ ...project, meta }),
                    phases.some((ph) => ph.milestones.length > 0) ? "Roadmap laten checken" : "Roadmap laten genereren",
                  )
                }
              >
                {phases.some((ph) => ph.milestones.length > 0) ? "Roadmap laten checken" : "Roadmap laten genereren"}
              </button>
            )}
            <button className="mini" onClick={addPhase}>
              + Fase
            </button>
            <button
              className="mini"
              disabled={refreshing || !canLaunch}
              title="Leest .projectradar.json opnieuw; het bestand bepaalt de structuur, afgevinkte mijlpalen blijven afgevinkt"
              onClick={refreshFromFile}
            >
              {refreshing ? "Verversen…" : "↻ Verversen uit bestand"}
            </button>
            <button
              className="mini ghost"
              title="Instructies voor Claude bekijken of aanpassen"
              onClick={() => setEditingInstructions(true)}
            >
              ⚙ Instructies{meta.claudeInstructions?.trim() ? "" : " (leeg)"}
            </button>
            <button
              className={`mini${hideCompleted ? " pri" : " ghost"}`}
              title="Afgevinkte mijlpalen en volledig afgeronde fasen verbergen"
              onClick={toggleHideCompleted}
            >
              {hideCompleted ? "☑" : "☐"} Verberg afgevinkte
            </button>
          </div>

          {refreshMsg && (
            <p className="hint" style={{ marginBottom: 0 }}>{refreshMsg}</p>
          )}

          {phases.length === 0 && (
            <p className="hint" style={{ marginBottom: 0 }}>Nog geen fasen. Voeg er een toe, of laat Claude er een genereren.</p>
          )}

          {hideCompleted && (hiddenPhaseCount > 0 || hiddenMilestoneCount > 0) && (
            <p className="hint" style={{ marginBottom: 0 }}>
              {hiddenPhaseCount > 0 && `${hiddenPhaseCount} afgeronde ${hiddenPhaseCount === 1 ? "fase" : "fasen"}`}
              {hiddenPhaseCount > 0 && hiddenMilestoneCount > 0 && " en "}
              {hiddenMilestoneCount > 0 && `${hiddenMilestoneCount} afgevinkte ${hiddenMilestoneCount === 1 ? "mijlpaal" : "mijlpalen"}`}
              {" "}verborgen.
            </p>
          )}

          {visiblePhases.map((ph) => {
            const done = ph.milestones.filter((m) => m.done).length;
            const visibleMilestones = hideCompleted ? ph.milestones.filter((m) => !m.done) : ph.milestones;
            return (
              <div className={`roadmap-phase${ph.onHold ? " on-hold" : ""}`} key={ph.id}>
                <div className="ph-head">
                  <input
                    className="ph-name"
                    value={ph.name ?? ""}
                    onChange={(e) => updatePhase(ph.id, { name: e.target.value })}
                  />
                  <span className="count">
                    {done}/{ph.milestones.length}
                  </span>
                  <input
                    className="ph-target"
                    placeholder="streefdatum"
                    value={ph.target ?? ""}
                    onChange={(e) => updatePhase(ph.id, { target: e.target.value })}
                  />
                  <SchedulePicker
                    value={ph.scheduledAt}
                    onChange={(iso) => updatePhase(ph.id, { scheduledAt: iso })}
                  />
                  <button
                    className={`ph-hold${ph.onHold ? " on" : ""}`}
                    onClick={() => updatePhase(ph.id, { onHold: !ph.onHold })}
                    title={ph.onHold ? "Fase staat on hold — klik om weer actief te zetten" : "Zet deze fase on hold (wordt overgeslagen bij 'Pak de draad op')"}
                  >
                    {ph.onHold ? "▶" : "⏸"}
                  </button>
                  <button className="rm" onClick={() => removePhase(ph.id)} title="Fase verwijderen">
                    ✕
                  </button>
                </div>
                {visibleMilestones.map((m) => (
                  <div className={`milestone${m.done ? " done" : ""}`} key={m.id}>
                    <input
                      type="checkbox"
                      checked={m.done}
                      onChange={(e) => updateMilestone(ph.id, m.id, { done: e.target.checked })}
                    />
                    <input
                      className="ms-text"
                      value={m.text ?? ""}
                      onChange={(e) => updateMilestone(ph.id, m.id, { text: e.target.value })}
                    />
                    {!m.done && canLaunch && (
                      <button
                        className="ms-claude"
                        title="Laat Claude deze mijlpaal oppakken"
                        onClick={() =>
                          onClaude(project, `Werk deze mijlpaal uit: ${m.text}`, `Mijlpaal: ${m.text}`)
                        }
                      >
                        Claude
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
        </CollapsiblePanel>

        <CollapsiblePanel
          id={pid("claude")}
          title={
            <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
              Doorwerken met Claude
              <ClaudeBadge state={claudeState} />
            </span>
          }
        >
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
              onClaude(project, claudeInput, claudeInput.trim() || "Eerstvolgende mijlpaal opgepakt");
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
        </CollapsiblePanel>

        <CollapsiblePanel id={pid("kwaliteit")} title="Kwaliteit checken">
          <p className="hint">
            Laat Claude de codebase of de vormgeving doorlichten: netheid, onveiligheden,
            consistentie en toegankelijkheid. Bevindingen komen in de terminal en kleine,
            evidente problemen worden meteen gefixt — grotere wijzigingen stelt Claude eerst voor.
          </p>
          <div className="toolbar">
            <button
              className="mini pri"
              disabled={!canLaunch}
              title={canLaunch ? "Laat Claude de code checken op netheid en veiligheid" : "Project staat niet op deze PC"}
              onClick={() => onClaude({ ...project, meta }, buildCodeCheckInstruction({ ...project, meta }), "Code gecheckt")}
            >
              Code checken
            </button>
            <button
              className="mini pri"
              disabled={!canLaunch}
              title={canLaunch ? "Laat Claude de UI/UX en vormgeving checken" : "Project staat niet op deze PC"}
              onClick={() => onClaude({ ...project, meta }, buildDesignCheckInstruction({ ...project, meta }), "Design gecheckt")}
            >
              Design checken
            </button>
            <button
              className="mini ghost"
              title="Design-instructies voor Claude bekijken of aanpassen"
              onClick={() => setEditingDesignInstructions(true)}
            >
              ⚙ Design-instructies{meta.designInstructions?.trim() ? "" : " (leeg)"}
            </button>
          </div>
        </CollapsiblePanel>

        <CollapsiblePanel
          id={pid("geschiedenis")}
          className="span-full"
          title="Geschiedenis"
          summary={lastRun ? `${lastRun.label} · ${relativeTime(lastRun.at)}` : "Nog geen runs"}
        >
          <p className="hint">Log van Claude-runs die via ProjectRadar zijn gestart, nieuwste eerst.</p>
          {!meta.history?.length ? (
            <p className="hint" style={{ marginBottom: 0 }}>Nog geen runs gestart.</p>
          ) : (
            <div className="history-list">
              {meta.history.slice(0, 30).map((h) => (
                <div className="history-row" key={h.id}>
                  <span className="history-time">{relativeTime(h.at)}</span>
                  <span className="history-label">{h.label}</span>
                </div>
              ))}
            </div>
          )}
        </CollapsiblePanel>

        <CollapsiblePanel id={pid("verwijderen")} className="danger-zone" title="Verwijderen" defaultCollapsed>
          <p className="hint">
            Haal dit project uit het overzicht — optioneel ook de lokale map (naar de
            prullenbak) en de GitHub-repo.
          </p>
          <button className="btn danger" onClick={() => setConfirming(true)}>
            Project verwijderen…
          </button>
        </CollapsiblePanel>
      </div>

      {editingInstructions && (
        <ClaudeInstructionsModal
          value={meta.claudeInstructions ?? ""}
          onCancel={() => setEditingInstructions(false)}
          onSave={(value) => {
            update({ claudeInstructions: value || undefined });
            setEditingInstructions(false);
          }}
        />
      )}

      {editingDesignInstructions && (
        <ClaudeInstructionsModal
          value={meta.designInstructions ?? ""}
          onCancel={() => setEditingDesignInstructions(false)}
          onSave={(value) => {
            update({ designInstructions: value || undefined });
            setEditingDesignInstructions(false);
          }}
          title="Design-instructies voor Claude"
          hint="Project-specifieke instructies die worden meegestuurd bij 'Design checken' — bijvoorbeeld je designsysteem, merkrichtlijnen, doelgroep of toegankelijkheidseisen. Wordt opgeslagen in .projectradar.json."
          placeholder="Bijv. 'Houd je aan het Radix-kleurenpalet' of 'Moet ook goed werken voor slechtziende gebruikers (WCAG AA)'…"
        />
      )}

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
