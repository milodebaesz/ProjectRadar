import { describe, it, expect } from "vitest";
import type { Project, ProjectMeta, RepoInfo, Status } from "../types";
import { projectStats, summarize, barHeights, peakWeek } from "./stats";

function repo(name: string, weeks: number[], path = `/code/${name}`): RepoInfo {
  return {
    path,
    name,
    branch: "main",
    detached: false,
    last_commit_hash: "abc123",
    last_commit_message: "init",
    last_commit_date: "2026-06-01T10:00:00Z",
    total_commits: 9,
    weekly_commits: weeks[0] ?? 0,
    commit_weeks: weeks,
    has_uncommitted: false,
    remote_url: null,
    has_upstream: false,
    ahead: 0,
    behind: 0,
    detected_stack: [],
    default_run_command: null,
    default_dev_url: null,
    radar_meta: null,
  };
}

function project(name: string, status: Status): Project {
  const meta: ProjectMeta = { key: name.toLowerCase(), status };
  return {
    key: name.toLowerCase(),
    name,
    meta,
    states: [],
    detectedStack: [],
    remoteUrl: null,
  };
}

describe("projectStats", () => {
  it("sorteert op totaal, hoogste eerst", () => {
    const stats = projectStats(
      [repo("Alpha", [1, 1]), repo("Beta", [5, 2]), repo("Gamma", [0, 1])],
      [],
    );
    expect(stats.map((s) => s.name)).toEqual(["Beta", "Alpha", "Gamma"]);
    expect(stats[0].total).toBe(7);
    expect(stats[0].thisWeek).toBe(5);
  });

  it("houdt de volgorde stabiel bij een gelijk totaal", () => {
    const stats = projectStats([repo("Zeta", [2]), repo("Alpha", [2])], []);
    expect(stats.map((s) => s.name)).toEqual(["Alpha", "Zeta"]);
  });

  it("telt twee repo's met dezelfde projectnaam bij elkaar op", () => {
    // Zelfde project in twee root-mappen: buildProjects voegt die ook samen,
    // dus de statistiek mag 'm niet twee keer als losse regel tonen.
    const stats = projectStats(
      [repo("Demo", [1, 2, 0], "/code/a/Demo"), repo("demo", [3, 0, 4], "/code/b/demo")],
      [],
    );
    expect(stats).toHaveLength(1);
    expect(stats[0].weeks).toEqual([4, 2, 4]);
    expect(stats[0].total).toBe(10);
    expect(stats[0].thisWeek).toBe(4);
  });

  it("neemt naam en status over uit het projectoverzicht", () => {
    const stats = projectStats([repo("demo", [1])], [project("Demo", "actief")]);
    expect(stats[0].name).toBe("Demo");
    expect(stats[0].status).toBe("actief");
  });

  it("overleeft een repo zonder commit_weeks", () => {
    // Cloud-only of een oudere backend: het veld kan ontbreken.
    const zonder = { ...repo("Oud", []), commit_weeks: undefined } as unknown as RepoInfo;
    const stats = projectStats([zonder], []);
    expect(stats[0].weeks).toEqual([]);
    expect(stats[0].thisWeek).toBe(0);
    expect(stats[0].total).toBe(0);
  });
});

describe("summarize", () => {
  it("telt commits per week over alle projecten op", () => {
    const stats = projectStats([repo("A", [2, 0, 1]), repo("B", [1, 3, 0])], []);
    const s = summarize(stats, [project("A", "actief"), project("B", "onhold")]);
    expect(s.weeks).toEqual([3, 3, 1]);
    expect(s.thisWeek).toBe(3);
    expect(s.total).toBe(7);
    expect(s.windowWeeks).toBe(3);
    expect(s.perWeek).toBeCloseTo(2.3, 5);
  });

  it("telt alleen projecten met status 'actief' als actief", () => {
    const projects = [project("A", "actief"), project("B", "afgerond"), project("C", "actief")];
    const s = summarize([], projects);
    expect(s.projects).toBe(3);
    expect(s.active).toBe(2);
  });

  it("telt projecten met en zonder commits apart", () => {
    const stats = projectStats([repo("A", [0, 0]), repo("B", [1, 0])], []);
    expect(summarize(stats, []).withCommits).toBe(1);
  });

  it("deelt niet door nul zonder scan", () => {
    const s = summarize([], []);
    expect(s.perWeek).toBe(0);
    expect(s.weeks).toEqual([]);
    expect(s.windowWeeks).toBe(0);
  });
});

describe("barHeights", () => {
  it("schaalt tegen het gedeelde maximum", () => {
    expect(barHeights([4, 2, 0], 4)).toEqual([1, 0.5, 0]);
  });

  it("geeft een week met commits altijd een zichtbare stomp", () => {
    // 1 op 100 is 0,01 — zonder ondergrens niet van 'geen commit' te zien.
    const [een, geen] = barHeights([1, 0], 100);
    expect(een).toBe(0.08);
    expect(geen).toBe(0);
  });

  it("levert nullen als er nergens gecommit is", () => {
    expect(barHeights([0, 0], 0)).toEqual([0, 0]);
  });
});

describe("peakWeek", () => {
  it("vindt de drukste week over alle projecten", () => {
    const stats = projectStats([repo("A", [1, 7]), repo("B", [3, 0])], []);
    expect(peakWeek(stats)).toBe(7);
  });

  it("is 0 zonder gegevens", () => {
    expect(peakWeek([])).toBe(0);
  });
});
