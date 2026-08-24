import { useEffect, useRef } from "react";
import type { Project } from "../types";
import type { TermSpec } from "../components/TerminalDock";
import { localPath } from "../lib/model";
import { nightlySessions, pushProjectPaths } from "../lib/tauri";

const POLL_MS = 3000;

/**
 * Verbindt de nachtelijke prompt-runner (Rust, `nightly.rs`) met de
 * terminal-dock. Doet twee dingen:
 *
 * 1. Pusht bij elke projectlijst-wijziging `{key, pad}` van projecten die op
 *    déze PC staan — de Rust-kant kent de scan-roots niet en kan dus zonder
 *    dit geen lokaal pad aan een PromptPad-project koppelen.
 * 2. Pollt welke managed sessies er zijn en opent voor elke nieuwe een
 *    read-only tab in de dock. De sessie zelf is al gestart door Rust (ook
 *    als de app dat niet zag gebeuren, bijv. door een vergrendeld scherm) —
 *    deze hook toont 'm alleen, hij drijft 'm niet aan.
 */
export function useNightlyRuns(tauri: boolean, projects: Project[], openTerminal: (spec: Omit<TermSpec, "id">) => void) {
  useEffect(() => {
    if (!tauri) return;
    const pairs: [string, string][] = [];
    for (const p of projects) {
      const path = localPath(p);
      if (path) pairs.push([p.key, path]);
    }
    pushProjectPaths(pairs).catch(() => {});
  }, [tauri, projects]);

  const knownIds = useRef<Set<number>>(new Set());
  useEffect(() => {
    if (!tauri) return;
    let cancelled = false;

    async function tick() {
      let sessions;
      try {
        sessions = await nightlySessions();
      } catch {
        return;
      }
      if (cancelled) return;
      for (const s of sessions) {
        if (knownIds.current.has(s.id)) continue;
        knownIds.current.add(s.id);
        openTerminal({
          title: `🌙 ${s.title}`,
          cwd: "",
          managedId: s.id,
        });
      }
    }

    tick();
    const id = window.setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tauri]);
}
