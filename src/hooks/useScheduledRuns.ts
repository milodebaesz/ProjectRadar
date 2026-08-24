import { useEffect, useRef } from "react";
import type { Project, ProjectMeta, Phase } from "../types";
import { buildScheduleEntry, scheduleIdOf } from "../lib/model";
import { scheduleClear, scheduleSet, takeFiredSchedules } from "../lib/tauri";

const POLL_MS = 20_000;
/** Hoe ver een scheduledAt in het verleden mag liggen voor we 'm als "al
 * afgevuurd maar nooit opgeruimd" beschouwen i.p.v. 'm opnieuw te bewapenen. */
const STALE_MS = 5 * 60_000;

/**
 * Bewaakt geplande sprint-starts (Fase.scheduledAt). Het daadwerkelijke
 * afvuren gebeurt niet hier, maar autonoom in de Rust-backend (zie
 * `schedule.rs`) — die draait als OS-thread, onafhankelijk van de webview, en
 * blijft dus ook lopen als het scherm vergrendeld is (`setInterval` in de
 * webview zou dat niet doen: WKWebView throttlet JS-timers zodra het venster
 * occluded raakt, zoals bij een vergrendeld scherm).
 *
 * Deze hook doet twee dingen:
 * 1. Bij elke projectlijst-wijziging alle geplande fasen opnieuw pushen naar
 *    de Rust-store (idempotent) — vangt op dat schedules daar ontbreken na
 *    een herstart of app-update. Fasen waarvan de geplande tijd al ruim
 *    verstreken is worden juist actief opgeruimd (zie hieronder waarom).
 * 2. Elke 20s pollen welke geplande runs inmiddels zijn afgevuurd, en die
 *    verwerken in de lokale geschiedenis + een toast, zodat je het alsnog
 *    ziet zodra je terug bent — ook al is die poll zelf ook een webview-timer,
 *    hij hoeft alleen te lopen als je weer kijkt, niet om de actie te starten.
 *
 * BUG-vangnet: `Phase.scheduledAt` wordt hier na een fire meteen gewist. Doen
 * we dat niet, dan blijft de fase een verstreken scheduledAt houden, pusht
 * reconciliatie 'm bij de eerstvolgende projectlijst-wijziging weer terug
 * naar Rust, vuurt hij 20s later opnieuw af, wat de projectlijst weer laat
 * wijzigen (via de Claude-statuspolling) — een oneindige lus die onbeheerd
 * Claude-sessies blijft starten. De STALE_MS-check hieronder is het vangnet
 * voor schedules die al zo'n lus hebben veroorzaakt vóór deze fix bestond.
 */
export function useScheduledRuns(
  tauri: boolean,
  projects: Project[],
  onSaveMeta: (meta: ProjectMeta) => void,
  showToast: (msg: string) => void,
) {
  const projectsRef = useRef(projects);
  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  /** Wis de scheduledAt van één fase in de meta van dit project (lokaal + Rust-store). */
  function clearPhaseSchedule(p: Project, phaseId: string) {
    const roadmap = (p.meta.roadmap ?? []).map((ph: Phase) =>
      ph.id === phaseId ? { ...ph, scheduledAt: undefined } : ph,
    );
    onSaveMeta({ ...p.meta, key: p.key, roadmap });
    scheduleClear(scheduleIdOf(p.key, phaseId)).catch(() => {});
  }

  // Reconciliatie: geplande fasen pushen naar de Rust-scheduler, en fasen met
  // een allang verstreken scheduledAt juist opruimen i.p.v. herbewapenen.
  useEffect(() => {
    if (!tauri) return;
    const now = Date.now();
    for (const p of projects) {
      for (const phase of p.meta.roadmap ?? []) {
        if (!phase.scheduledAt) continue;
        const at = new Date(phase.scheduledAt).getTime();
        if (!Number.isNaN(at) && now - at > STALE_MS) {
          clearPhaseSchedule(p, phase.id);
          continue;
        }
        const entry = buildScheduleEntry(p, phase);
        if (entry) scheduleSet(entry).catch(() => {});
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tauri, projects]);

  // Poll: verwerk wat er sinds de vorige keer is afgevuurd.
  useEffect(() => {
    if (!tauri) return;

    async function tick() {
      let fired;
      try {
        fired = await takeFiredSchedules();
      } catch {
        return;
      }
      for (const f of fired) {
        const p = projectsRef.current.find((x) => x.key === f.projectKey);
        const label = `Gepland: ${f.phaseName}`;
        if (p) {
          const phaseId = f.id.startsWith(`${f.projectKey}:`) ? f.id.slice(f.projectKey.length + 1) : null;
          const roadmap = phaseId
            ? (p.meta.roadmap ?? []).map((ph) => (ph.id === phaseId ? { ...ph, scheduledAt: undefined } : ph))
            : p.meta.roadmap;
          const entry = { id: f.id, at: new Date(f.firedAtMs).toISOString(), label };
          const history = [entry, ...(p.meta.history ?? [])].slice(0, 100);
          onSaveMeta({ ...p.meta, key: p.key, roadmap, history });
        }
        showToast(`Geplande sprint gestart: ${f.phaseName}${p ? ` (${p.name})` : ""}`);
      }
    }

    tick();
    const id = window.setInterval(tick, POLL_MS);
    return () => window.clearInterval(id);
  }, [tauri, onSaveMeta, showToast]);
}
