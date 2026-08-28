import { describe, it, expect } from "vitest";
import type { NightlyRun, RunOutcome } from "./tauri";
import { groupByNight, summarize, summaryText, unseenRuns, durationOf } from "./nightly";

function run(p: Partial<NightlyRun> & { startedAt: string }): NightlyRun {
  return {
    promptId: p.promptId ?? Math.random().toString(36).slice(2),
    title: "Een prompt",
    projectName: "Demo",
    projectKey: "demo",
    finishedAt: null,
    outcome: "done" as RunOutcome,
    reason: null,
    logPath: null,
    ...p,
  };
}

// De nachtrun draait tussen 03:00 en 06:00, dus een run draagt altijd de
// datum van de ochtend waarop je 'm leest.
const NU = new Date("2026-08-24T09:00:00+02:00").getTime();

describe("groupByNight", () => {
  it("noemt de runs van vanochtend 'Vannacht' en die van de dag ervoor 'Gisternacht'", () => {
    const groepen = groupByNight(
      [
        run({ startedAt: "2026-08-24T03:12:00+02:00" }),
        run({ startedAt: "2026-08-23T03:40:00+02:00" }),
      ],
      NU,
    );
    expect(groepen.map((g) => g.label)).toEqual(["Vannacht", "Gisternacht"]);
  });

  it("zet de nieuwste nacht bovenaan, maar binnen een nacht chronologisch", () => {
    const groepen = groupByNight(
      [
        run({ startedAt: "2026-08-24T04:30:00+02:00", title: "tweede" }),
        run({ startedAt: "2026-08-24T03:10:00+02:00", title: "eerste" }),
        run({ startedAt: "2026-08-20T03:00:00+02:00", title: "oud" }),
      ],
      NU,
    );
    expect(groepen[0].runs.map((r) => r.title)).toEqual(["eerste", "tweede"]);
    expect(groepen[1].runs.map((r) => r.title)).toEqual(["oud"]);
  });

  it("schrijft oudere nachten uit als datum", () => {
    const [g] = groupByNight([run({ startedAt: "2026-08-20T03:00:00+02:00" })], NU);
    expect(g.label).not.toBe("Vannacht");
    expect(g.label).toMatch(/20/);
  });

  it("telt per nacht hoe het afliep", () => {
    const [g] = groupByNight(
      [
        run({ startedAt: "2026-08-24T03:00:00+02:00", outcome: "done" }),
        run({ startedAt: "2026-08-24T03:30:00+02:00", outcome: "failed" }),
        run({ startedAt: "2026-08-24T04:00:00+02:00", outcome: "skipped" }),
      ],
      NU,
    );
    expect(g.summary).toEqual({ done: 1, failed: 1, skipped: 1, total: 3 });
  });
});

describe("summaryText", () => {
  it("noemt alleen wat er is", () => {
    expect(summaryText(summarize([run({ startedAt: "x", outcome: "done" })]))).toBe("1 klaar");
    expect(summaryText({ done: 2, failed: 1, skipped: 0, total: 3 })).toBe("2 klaar, 1 mislukt");
  });

  it("zegt iets zinnigs bij een lege nacht", () => {
    expect(summaryText({ done: 0, failed: 0, skipped: 0, total: 0 })).toBe("niets uitgevoerd");
  });
});

describe("unseenRuns", () => {
  it("beschouwt alles als nieuw als je nog nooit gekeken hebt", () => {
    const runs = [run({ startedAt: "2026-08-24T03:00:00+02:00" })];
    expect(unseenRuns(runs, null)).toHaveLength(1);
  });

  it("vergelijkt op tijdstip, niet op tekst — tijdzones lopen anders uiteen", () => {
    // Zelfde moment, andere offset: mag niet als "nieuw" gelden.
    const runs = [run({ startedAt: "2026-08-24T03:00:00+02:00" })];
    expect(unseenRuns(runs, "2026-08-24T01:00:00Z")).toHaveLength(0);
    expect(unseenRuns(runs, "2026-08-24T00:59:00Z")).toHaveLength(1);
  });
});

describe("durationOf", () => {
  it("geeft niets terug voor een run die nog loopt", () => {
    expect(durationOf(run({ startedAt: "2026-08-24T03:00:00+02:00" }))).toBe("");
  });

  it("rekent minuten en uren uit", () => {
    const maak = (min: number) =>
      durationOf(
        run({
          startedAt: "2026-08-24T03:00:00+02:00",
          finishedAt: new Date(new Date("2026-08-24T03:00:00+02:00").getTime() + min * 60_000).toISOString(),
        }),
      );
    expect(maak(0)).toBe("< 1 min");
    expect(maak(24)).toBe("24 min");
    expect(maak(64)).toBe("1u 04m");
  });
});
