import { useEffect, useMemo, useRef, useState } from "react";
import type { ClaudeState, Project } from "../types";
import { localPath } from "../lib/model";
import { claudeStatus } from "../lib/tauri";

/**
 * Pollt de Claude-hook-statusbestanden via de backend en mapt ze op project-key
 * (op lokaal pad gematcht). Een "busy" dat >10 min niet ververst is, telt als
 * idle (afgebroken sessie of Claude wacht op input).
 *
 * `onSessionDone` vuurt precies op de busy→idle-overgang (Claude's eigen
 * Stop-hook, dus een afgeronde beurt) — de aangewezen plek om een rescan te
 * triggeren zodat roadmap-wijzigingen die Claude in `.projectradar.json`
 * schreef meteen zichtbaar worden.
 */
export function useClaudeStatus(
  tauri: boolean,
  projects: Project[],
  onSessionDone?: (projectKey: string) => void,
): Record<string, ClaudeState> {
  const [rows, setRows] = useState<Record<string, { state: string; ts: number }>>({});

  const projectsRef = useRef(projects);
  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  const onSessionDoneRef = useRef(onSessionDone);
  useEffect(() => {
    onSessionDoneRef.current = onSessionDone;
  });

  const prevStateRef = useRef<Record<string, string>>({});

  useEffect(() => {
    if (!tauri) return;
    let active = true;
    const tick = async () => {
      try {
        const r = await claudeStatus();
        if (!active) return;

        for (const row of r) {
          const wasBusy = prevStateRef.current[row.path] === "busy";
          if (wasBusy && row.state === "idle") {
            const proj = projectsRef.current.find((p) => localPath(p) === row.path);
            if (proj) onSessionDoneRef.current?.(proj.key);
          }
        }
        prevStateRef.current = Object.fromEntries(r.map((x) => [x.path, x.state]));

        setRows(Object.fromEntries(r.map((x) => [x.path, { state: x.state, ts: x.ts }])));
      } catch {
        /* negeer */
      }
    };
    tick();
    const id = window.setInterval(tick, 2500);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, [tauri]);

  return useMemo(() => {
    const now = Date.now() / 1000;
    const m: Record<string, ClaudeState> = {};
    for (const p of projects) {
      const path = localPath(p);
      if (!path) continue;
      const row = rows[path];
      if (!row || now - row.ts > 8 * 3600) continue;
      const age = now - row.ts;
      if (row.state === "busy") m[p.key] = age > 600 ? "idle" : "busy";
      else if (row.state === "idle") m[p.key] = "idle";
    }
    return m;
  }, [projects, rows]);
}
