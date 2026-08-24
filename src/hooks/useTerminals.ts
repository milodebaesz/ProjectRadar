import { useState } from "react";
import type { TermSpec } from "../components/TerminalDock";
import { uid } from "../lib/format";

/** Beheer van de ingebouwde terminal-dock (tabs, actieve tab, open/dicht). */
export function useTerminals(defaultCwd: string) {
  const [terminals, setTerminals] = useState<TermSpec[]>([]);
  const [activeTermId, setActiveTermId] = useState<string | null>(null);
  const [dockOpen, setDockOpen] = useState(false);

  function openTerminal(spec: Omit<TermSpec, "id">) {
    const id = uid();
    setTerminals((prev) => [...prev, { ...spec, id }]);
    setActiveTermId(id);
    setDockOpen(true);
  }

  function removeTerminal(id: string) {
    setTerminals((prev) => {
      const next = prev.filter((t) => t.id !== id);
      setActiveTermId((cur) => (cur === id ? next[next.length - 1]?.id ?? null : cur));
      return next;
    });
  }

  function newPlainTerminal() {
    // Lege cwd → de backend valt terug op de home-map.
    openTerminal({ title: "shell", cwd: defaultCwd });
  }

  return {
    terminals,
    activeTermId,
    setActiveTermId,
    dockOpen,
    setDockOpen,
    openTerminal,
    removeTerminal,
    newPlainTerminal,
  };
}
