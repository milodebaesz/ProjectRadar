import { describe, it, expect } from "vitest";
import type { Phase, Project, ProjectMeta, RepoInfo } from "../types";
import {
  buildProjects,
  compareStates,
  runCommandOf,
  devUrlOf,
  roadmapProgress,
  portFromUrl,
  effectiveStack,
  reconcileRoadmap,
  refreshRoadmapFromFile,
  byRank,
  reorderProjects,
  dedupeRoadmap,
  normalizeRoadmap,
} from "./model";

/** Minimale RepoInfo-fixture; overschrijf alleen wat de test nodig heeft. */
function repo(p: Partial<RepoInfo> = {}): RepoInfo {
  return {
    path: "/code/demo",
    name: "Demo",
    branch: "main",
    detached: false,
    last_commit_hash: "abc123",
    last_commit_message: "init",
    last_commit_date: "2026-06-01T10:00:00Z",
    total_commits: 3,
    weekly_commits: 1,
    has_uncommitted: false,
    remote_url: null,
    has_upstream: false,
    ahead: 0,
    behind: 0,
    detected_stack: [],
    default_run_command: null,
    default_dev_url: null,
    radar_meta: null,
    ...p,
  };
}

describe("buildProjects / mergeMeta seed-precedence", () => {
  it("seedt lege velden vanuit .projectradar.json", () => {
    const repos = [repo({ radar_meta: { description: "Uit bestand", status: "actief" } })];
    const [p] = buildProjects(repos, {}, "mac");
    expect(p.meta.description).toBe("Uit bestand");
    expect(p.meta.status).toBe("actief");
  });

  it("overschrijft een handmatige cache-waarde NOOIT (regressie #2)", () => {
    const cache: Record<string, ProjectMeta> = {
      demo: { key: "demo", description: "Handmatig", status: "onhold" },
    };
    const repos = [repo({ radar_meta: { description: "Uit bestand", status: "actief" } })];
    const [p] = buildProjects(repos, cache, "mac");
    expect(p.meta.description).toBe("Handmatig");
    expect(p.meta.status).toBe("onhold");
  });

  it("behandelt default-status 'idee' als seedbaar", () => {
    const cache: Record<string, ProjectMeta> = { demo: { key: "demo", status: "idee" } };
    const repos = [repo({ radar_meta: { status: "afgerond" } })];
    const [p] = buildProjects(repos, cache, "mac");
    expect(p.meta.status).toBe("afgerond");
  });

  it("seedt links per sub-veld zonder een handmatige repo-URL te verliezen", () => {
    const cache: Record<string, ProjectMeta> = {
      demo: { key: "demo", links: { repo: "https://eigen/repo" } },
    };
    const repos = [
      repo({ radar_meta: { links: { repo: "https://bestand/repo", deploy: "https://bestand/deploy" } } }),
    ];
    const [p] = buildProjects(repos, cache, "mac");
    expect(p.meta.links?.repo).toBe("https://eigen/repo");
    expect(p.meta.links?.deploy).toBe("https://bestand/deploy");
  });

  it("voegt dezelfde repo op twee machines samen tot één project met twee states", () => {
    const repos = [
      repo({ name: "Demo", path: "/mac/demo" }),
      repo({ name: "demo", path: "/mac/demo2" }),
    ];
    const projects = buildProjects(repos, {}, "mac");
    expect(projects).toHaveLength(1);
    expect(projects[0].states).toHaveLength(2);
  });
});

describe("compareStates", () => {
  const base = repo();

  it("is in sync bij gelijke laatste commit-hash", () => {
    const projects = buildProjects([base], {}, "mac");
    // Eén state → altijd in sync.
    expect(compareStates(projects[0]).inSync).toBe(true);
  });

  it("wijst de machine met de jongste commit aan als voorloper", () => {
    const p = buildProjects([base], {}, "mac")[0];
    p.states.push({
      machine: "laptop",
      path: null,
      branch: "main",
      detached: false,
      lastCommitDate: "2026-06-10T10:00:00Z",
      lastCommitHash: "zzz999",
      totalCommits: 5,
      weeklyCommits: 2,
      hasUncommitted: false,
      ahead: 0,
      behind: 0,
      isThisPc: false,
    });
    const cmp = compareStates(p);
    expect(cmp.inSync).toBe(false);
    expect(cmp.leadMachine).toBe("laptop");
  });
});

describe("runCommandOf / devUrlOf", () => {
  it("handmatig runCommand wint van auto-detectie", () => {
    const p = buildProjects(
      [repo({ default_run_command: "npm start", radar_meta: { runCommand: "pnpm dev" } })],
      {},
      "mac",
    )[0];
    expect(runCommandOf(p)).toBe("pnpm dev");
  });

  it("valt terug op de auto-detectie en daarna op npm run dev", () => {
    const auto = buildProjects([repo({ default_run_command: "npm start" })], {}, "mac")[0];
    expect(runCommandOf(auto)).toBe("npm start");
    const none = buildProjects([repo()], {}, "mac")[0];
    expect(runCommandOf(none)).toBe("npm run dev");
  });

  it("devUrlOf geeft null als er niets bekend is", () => {
    const p = buildProjects([repo()], {}, "mac")[0];
    expect(devUrlOf(p)).toBeNull();
  });
});

describe("roadmapProgress / effectiveStack", () => {
  it("rekent het percentage afgevinkte mijlpalen", () => {
    const p = buildProjects(
      [
        repo({
          radar_meta: {
            roadmap: [
              {
                id: "f1",
                name: "MVP",
                milestones: [
                  { id: "a", text: "x", done: true },
                  { id: "b", text: "y", done: false },
                ],
              },
            ],
          },
        }),
      ],
      {},
      "mac",
    )[0];
    expect(roadmapProgress(p)).toEqual({ done: 1, total: 2, pct: 50 });
  });

  it("geeft null zonder mijlpalen", () => {
    expect(roadmapProgress(buildProjects([repo()], {}, "mac")[0])).toBeNull();
  });

  it("handmatige stack wint van gedetecteerde", () => {
    const p = buildProjects(
      [repo({ detected_stack: ["React"], radar_meta: { stack: ["Rust"] } })],
      {},
      "mac",
    )[0];
    expect(effectiveStack(p)).toEqual(["Rust"]);
  });
});

describe("normalizeRoadmap", () => {
  it("behoudt scheduledAt (regressie: geplande sprints verdwenen via de cloud)", () => {
    // Elke roadmap die uit PocketBase komt gaat hier doorheen. Liet deze
    // functie scheduledAt vallen, dan kwam een ingeplande fase zonder planning
    // terug en vuurde de geplande sprint-start nooit meer af — zonder melding.
    const [phase] = normalizeRoadmap([
      {
        id: "f1",
        name: "Sprint 5",
        scheduledAt: "2026-09-01T09:00:00.000Z",
        milestones: [{ id: "a", text: "x", done: false }],
      },
    ]);
    expect(phase.scheduledAt).toBe("2026-09-01T09:00:00.000Z");
  });

  it("laat scheduledAt weg als de fase er geen heeft", () => {
    const [phase] = normalizeRoadmap([{ id: "f1", name: "Sprint 5", milestones: [] }]);
    expect(phase.scheduledAt).toBeUndefined();
  });

  it("corrigeert afwijkende veldnamen van Claude naar het schema", () => {
    const [phase] = normalizeRoadmap([
      { title: "Fase A", milestones: [{ label: "Doe iets", completed: true }] },
    ]);
    expect(phase.name).toBe("Fase A");
    expect(phase.milestones[0].text).toBe("Doe iets");
    expect(phase.milestones[0].done).toBe(true);
  });
});

describe("reconcileRoadmap", () => {
  function phase(p: Partial<Phase> = {}): Phase {
    return { id: "f1", name: "MVP", milestones: [], ...p };
  }

  it("neemt done: true uit het bestand over zonder een lokale done terug te zetten", () => {
    const cached = [phase({ milestones: [{ id: "a", text: "x", done: false }, { id: "b", text: "y", done: true }] })];
    const file = [phase({ milestones: [{ id: "a", text: "x", done: true }, { id: "b", text: "y", done: false }] })];
    const result = reconcileRoadmap(cached, file);
    expect(result[0].milestones).toEqual([
      { id: "a", text: "x", done: true },
      { id: "b", text: "y", done: true },
    ]);
  });

  it("behoudt handmatig aangepaste fase-velden (naam, on hold, streefdatum)", () => {
    const cached = [phase({ name: "Eigen naam", onHold: true, target: "eind juli", milestones: [] })];
    const file = [phase({ name: "Fase uit bestand", onHold: false, milestones: [] })];
    const result = reconcileRoadmap(cached, file);
    expect(result[0]).toMatchObject({ name: "Eigen naam", onHold: true, target: "eind juli" });
  });

  it("voegt nieuwe mijlpalen en fasen uit het bestand toe", () => {
    const cached = [phase({ milestones: [{ id: "a", text: "x", done: false }] })];
    const file = [
      phase({ milestones: [{ id: "a", text: "x", done: false }, { id: "c", text: "nieuw", done: false }] }),
      phase({ id: "f2", name: "Fase 2", milestones: [{ id: "d", text: "z", done: false }] }),
    ];
    const result = reconcileRoadmap(cached, file);
    expect(result[0].milestones.map((m) => m.id)).toEqual(["a", "c"]);
    expect(result[1].id).toBe("f2");
  });

  it("dupliceert niet als Claude dezelfde mijlpaal/fase met een nieuwe id terugschrijft", () => {
    // Regressie: Claude krijgt in de prompt geen ruwe id's te zien en verzint
    // soms een nieuwe id bij het herschrijven van .projectradar.json. Matchen
    // moet dan op naam/tekst terugvallen, anders plakt de "nieuwe" mijlpaal
    // zich onder de bestaande in plaats van 'm bij te werken.
    const cached = [
      phase({
        id: "cached-phase-id",
        name: "MVP",
        milestones: [{ id: "cached-ms-id", text: "Login-flow bouwen", done: false }],
      }),
    ];
    const file = [
      phase({
        id: "regenerated-phase-id",
        name: "MVP",
        milestones: [{ id: "regenerated-ms-id", text: "Login-flow bouwen", done: true }],
      }),
    ];
    const result = reconcileRoadmap(cached, file);
    expect(result).toHaveLength(1);
    expect(result[0].milestones).toHaveLength(1);
    expect(result[0].milestones[0]).toMatchObject({ text: "Login-flow bouwen", done: true });
  });
});

describe("refreshRoadmapFromFile", () => {
  function phase(p: Partial<Phase> = {}): Phase {
    return { id: "f1", name: "MVP", milestones: [], ...p };
  }

  it("laat het bestand winnen op naam en volgorde, anders dan reconcileRoadmap", () => {
    const cached = [phase({ name: "Oude naam" }), phase({ id: "f2", name: "Fase 2" })];
    const file = [phase({ id: "f2", name: "Fase 2" }), phase({ name: "Nieuwe naam" })];
    const result = refreshRoadmapFromFile(cached, file);
    expect(result.map((p) => p.name)).toEqual(["Fase 2", "Nieuwe naam"]);
  });

  it("verwijdert wat niet meer in het bestand staat", () => {
    // Precies het geval dat reconcileRoadmap laat liggen: Claude ruimt een
    // afgeronde mijlpaal op, maar de cache bleef 'm tonen.
    const cached = [
      phase({ milestones: [{ id: "a", text: "blijft", done: false }, { id: "b", text: "opgeruimd", done: true }] }),
    ];
    const file = [phase({ milestones: [{ id: "a", text: "blijft", done: false }] })];
    const result = refreshRoadmapFromFile(cached, file);
    expect(result[0].milestones.map((m) => m.text)).toEqual(["blijft"]);
  });

  it("zet voortgang nooit terug", () => {
    const cached = [phase({ milestones: [{ id: "a", text: "x", done: true }] })];
    const file = [phase({ milestones: [{ id: "a", text: "x", done: false }] })];
    const result = refreshRoadmapFromFile(cached, file);
    expect(result[0].milestones[0].done).toBe(true);
  });

  it("behoudt on hold en planning als het bestand ze niet invult", () => {
    const cached = [phase({ onHold: true, scheduledAt: "2026-09-01T09:00:00Z", target: "eind juli" })];
    const file = [phase({ name: "MVP" })];
    const result = refreshRoadmapFromFile(cached, file);
    expect(result[0]).toMatchObject({ onHold: true, scheduledAt: "2026-09-01T09:00:00Z", target: "eind juli" });
  });

  it("laat het bestand een planning wél overschrijven als het die zelf zet", () => {
    const cached = [phase({ onHold: true })];
    const file = [phase({ onHold: false })];
    expect(refreshRoadmapFromFile(cached, file)[0].onHold).toBe(false);
  });

  it("houdt done vast als Claude de mijlpaal met een nieuwe id terugschrijft", () => {
    const cached = [phase({ milestones: [{ id: "oud", text: "Login-flow bouwen", done: true }] })];
    const file = [phase({ id: "nieuw-f", milestones: [{ id: "nieuw-m", text: "Login-flow bouwen", done: false }] })];
    const result = refreshRoadmapFromFile(cached, file);
    expect(result[0].milestones[0]).toMatchObject({ text: "Login-flow bouwen", done: true });
  });
});

describe("byRank / reorderProjects", () => {
  function proj(key: string, rank?: number): Project {
    return {
      key,
      name: key,
      meta: { key, rank },
      states: [],
      detectedStack: [],
      remoteUrl: null,
    };
  }

  it("zet projecten zonder rang onderaan, daar gesorteerd op naam", () => {
    const list = [proj("zonder-b"), proj("met", 0), proj("zonder-a")];
    expect([...list].sort(byRank).map((p) => p.key)).toEqual(["met", "zonder-a", "zonder-b"]);
  });

  it("verplaatst een project naar de positie van het doel", () => {
    const list = [proj("a", 0), proj("b", 1), proj("c", 2)];
    expect(reorderProjects(list, "c", "a")).toEqual(["c", "a", "b"]);
    expect(reorderProjects(list, "a", "c")).toEqual(["b", "c", "a"]);
  });

  it("geeft álle projecten terug, ook als de gesleepte weggefilterd zou zijn", () => {
    // De component sleept binnen de zichtbare kaarten, maar de rang moet over
    // de volledige lijst hernummerd worden — anders verliezen verborgen
    // projecten hun onderlinge volgorde.
    const list = [proj("verborgen", 0), proj("a", 1), proj("b", 2)];
    const result = reorderProjects(list, "b", "a");
    expect(result).toEqual(["verborgen", "b", "a"]);
  });

  it("laat de volgorde ongemoeid als bron en doel gelijk zijn", () => {
    const list = [proj("a", 0), proj("b", 1)];
    expect(reorderProjects(list, "a", "a")).toEqual(["a", "b"]);
  });

  it("nummert nooit-gesleepte projecten mee zodra er één versleept wordt", () => {
    const list = [proj("a"), proj("b"), proj("c")];
    expect(reorderProjects(list, "c", "a")).toEqual(["c", "a", "b"]);
  });
});

describe("dedupeRoadmap", () => {
  it("voegt fasen met dezelfde naam samen en dedupliceert hun mijlpalen op tekst", () => {
    const phases: Phase[] = [
      { id: "p1", name: "MVP", milestones: [{ id: "a", text: "Login", done: false }] },
      {
        id: "p2",
        name: "mvp", // andere casing, moet toch samengevoegd worden
        milestones: [
          { id: "b", text: "Login", done: true }, // duplicaat van "a" — done wint
          { id: "c", text: "Registratie", done: false },
        ],
      },
    ];
    const result = dedupeRoadmap(phases);
    expect(result).toHaveLength(1);
    expect(result[0].milestones).toHaveLength(2);
    expect(result[0].milestones.find((m) => m.text === "Login")?.done).toBe(true);
  });
});

describe("portFromUrl", () => {
  it("leest expliciete poort", () => {
    expect(portFromUrl("http://localhost:5173")).toBe(5173);
  });
  it("valt terug op 443/80 per protocol", () => {
    expect(portFromUrl("https://example.com")).toBe(443);
    expect(portFromUrl("http://example.com")).toBe(80);
  });
  it("null bij onzin", () => {
    expect(portFromUrl("geen-url")).toBeNull();
  });
});
