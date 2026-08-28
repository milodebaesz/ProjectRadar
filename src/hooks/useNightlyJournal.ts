import { useCallback, useEffect, useMemo, useState } from "react";
import { nightlyRuns, type NightlyRun } from "../lib/tauri";
import { unseenRuns } from "../lib/nightly";
import { loadNightlySeenAt, saveNightlySeenAt } from "../lib/storage";

/** Hoe vaak we het journaal herlezen. Een nachtrun duurt tientallen minuten,
 *  dus vaker pollen levert niets op. */
const POLL_MS = 60_000;

/**
 * Het nachtjournaal (Rust, `nightly.rs`) plus de vraag "heb ik dit al gezien".
 * Dat laatste leeft in localStorage en niet in het journaal zelf: het is een
 * eigenschap van deze machine/gebruiker, niet van de run.
 *
 * Niet te verwarren met `useNightlyRuns`: die kijkt naar de sessies die op
 * dít moment in het geheugen draaien en hangt er terminal-tabs aan. Deze hook
 * leest wat er is gebeurd — ook van nachten waarin de app niet eens open was.
 */
export function useNightlyJournal(tauri: boolean) {
  const [runs, setRuns] = useState<NightlyRun[]>([]);
  const [seenAt, setSeenAt] = useState<string | null>(() => loadNightlySeenAt());

  useEffect(() => {
    if (!tauri) return;
    let cancelled = false;
    const tick = () => {
      nightlyRuns()
        .then((r) => !cancelled && setRuns(r))
        .catch(() => {
          /* nog geen journaal, of de app draait zonder nachtrunner */
        });
    };
    tick();
    const id = window.setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [tauri]);

  const unseen = useMemo(() => unseenRuns(runs, seenAt), [runs, seenAt]);

  const markSeen = useCallback(() => {
    const now = new Date().toISOString();
    saveNightlySeenAt(now);
    setSeenAt(now);
  }, []);

  return { runs, unseen, markSeen };
}
