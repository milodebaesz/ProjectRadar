import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import type { ClaudeState, Project } from "../types";
import { buildRemoteSnapshot, buildPhasePrompt } from "../lib/model";
import { pushRemoteState } from "../lib/tauri";

interface RemoteActionPayload {
  projectKey: string;
  phaseId?: string;
  milestoneId?: string;
  done?: boolean;
}

interface RemoteActionEvent {
  type: "toggle_milestone" | "run_phase" | "run_milestone";
  payload: RemoteActionPayload;
}

/**
 * Brug tussen de webview en de Rust-server voor externe (Tailscale) bediening.
 * De webview blijft eigenaar van alle data — deze hook duwt alleen een
 * compacte snapshot naar Rust (voor `/api/state`) en voert acties uit die
 * vanaf de telefoon binnenkomen via hetzelfde `onToggleMilestone`/`onClaude`
 * pad als een klik in de UI zelf. Zie `remote.rs` voor de serverkant.
 */
export function useRemoteBridge(
  tauri: boolean,
  projects: Project[],
  claudeByKey: Record<string, ClaudeState>,
  onToggleMilestone: (p: Project, phaseId: string, msId: string, done: boolean) => void,
  onClaude: (p: Project, instruction: string, label?: string) => void,
) {
  useEffect(() => {
    if (!tauri) return;
    pushRemoteState(buildRemoteSnapshot(projects, claudeByKey)).catch(() => {});
  }, [tauri, projects, claudeByKey]);

  useEffect(() => {
    if (!tauri) return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    listen<RemoteActionEvent>("remote-action", (event) => {
      const { type, payload } = event.payload;
      const p = projects.find((x) => x.key === payload.projectKey);
      if (!p) return;
      const phase = payload.phaseId ? (p.meta.roadmap ?? []).find((ph) => ph.id === payload.phaseId) : undefined;

      if (type === "toggle_milestone" && payload.phaseId && payload.milestoneId) {
        onToggleMilestone(p, payload.phaseId, payload.milestoneId, !!payload.done);
      } else if (type === "run_phase" && phase) {
        onClaude(p, buildPhasePrompt(phase), `Sprint opgepakt (extern): ${phase.name}`);
      } else if (type === "run_milestone" && phase && payload.milestoneId) {
        const m = phase.milestones.find((mm) => mm.id === payload.milestoneId);
        if (m) onClaude(p, `Werk deze mijlpaal uit: ${m.text}`, `Mijlpaal (extern): ${m.text}`);
      }
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tauri, projects]);
}
