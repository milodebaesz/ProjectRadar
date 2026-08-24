import type { Project, ProjectMeta, RepoInfo, PcState, Status, Phase, Milestone, ClaudeState } from "../types";
import { projectKey } from "./format";

// Normaliseer roadmap-data die van een externe bron komt (Claude-gegenereerde JSON,
// PocketBase-veld). Claude gebruikt soms `description`, `label`, `title` of `name`
// waar het schema `text` verwacht. Deze functies corrigeren dat stilzwijgend.
function normalizeMilestone(m: Record<string, unknown>): Milestone {
  return {
    id: String(m.id ?? Math.random().toString(36).slice(2, 10)),
    text: String(m.text ?? m.label ?? m.description ?? m.title ?? ""),
    done: !!(m.done ?? m.completed ?? m.checked),
  };
}

function normalizePhase(ph: Record<string, unknown>): Phase {
  const ms = Array.isArray(ph.milestones) ? ph.milestones : [];
  return {
    id: String(ph.id ?? Math.random().toString(36).slice(2, 10)),
    name: String(ph.name ?? ph.title ?? "Fase"),
    target: ph.target != null ? String(ph.target) : undefined,
    onHold: !!(ph.onHold ?? ph.on_hold),
    // Moet mee: de cloud-roadmap gaat bij elke pull door deze functie heen, en
    // een fase die hier zijn scheduledAt verliest komt zonder planning terug —
    // waarna de geplande sprint-start stilletjes nooit meer afvuurt.
    scheduledAt: ph.scheduledAt != null ? String(ph.scheduledAt) : undefined,
    milestones: ms.map((m) => normalizeMilestone(m as Record<string, unknown>)),
  };
}

export function normalizeRoadmap(roadmap: unknown[]): Phase[] {
  return roadmap.map((ph) => normalizePhase(ph as Record<string, unknown>));
}

function normText(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * Ruim dubbele fasen/mijlpalen op (zelfde naam/tekst, ongeacht id). Nodig
 * omdat Claude bij het terugschrijven naar `.projectradar.json` niet altijd
 * de bestaande id's hergebruikt — `reconcileRoadmap` zag zo'n herschreven
 * mijlpaal voorheen als "nieuw" en plakte 'm erbij in plaats van bij te
 * werken, wat de roadmap bij herhaalde runs liet opzwellen. Deze functie is
 * zowel een eenmalige opschoning van al bestaande duplicaten als een
 * doorlopend vangnet in `reconcileRoadmap` zelf.
 */
export function dedupeRoadmap(phases: Phase[]): Phase[] {
  const byName = new Map<string, Phase>();
  const order: string[] = [];
  for (const ph of phases) {
    const key = normText(ph.name);
    let target = byName.get(key);
    if (!target) {
      target = { ...ph, milestones: [] };
      byName.set(key, target);
      order.push(key);
    } else {
      if (!target.target && ph.target) target.target = ph.target;
      if (!target.scheduledAt && ph.scheduledAt) target.scheduledAt = ph.scheduledAt;
    }
    const byText = new Map(target.milestones.map((m) => [normText(m.text), m]));
    for (const m of ph.milestones) {
      const mkey = normText(m.text);
      const existing = byText.get(mkey);
      if (existing) {
        if (m.done && !existing.done) existing.done = true;
      } else {
        const copy = { ...m };
        byText.set(mkey, copy);
        target.milestones.push(copy);
      }
    }
  }
  return order.map((key) => byName.get(key)!);
}

/**
 * Voegt roadmap-voortgang uit `.projectradar.json` (door Claude bijgewerkt na
 * een sprint) samen met de lokale cache. Een mijlpaal die ergens als `done`
 * gezet is blijft `done` — voortgang gaat nooit terug, ongeacht welke kant het
 * laatst schreef. Fasen/mijlpalen die alleen in het bestand staan (nieuw door
 * Claude toegevoegd) worden aangevuld; namen, teksten, on-hold en planning
 * blijven uit de cache, zodat handmatige bewerkingen nooit verloren gaan.
 */
export function reconcileRoadmap(cached: Phase[], file: Phase[]): Phase[] {
  // Match bij voorkeur op id, maar val terug op naam/tekst — Claude hergebruikt
  // de bestaande id's niet altijd als hij het bestand herschrijft, en op id
  // matchen zou zo'n mijlpaal ten onrechte als "nieuw" behandelen.
  const findPhase = (ph: Phase) =>
    file.find((f) => f.id === ph.id) ?? file.find((f) => normText(f.name) === normText(ph.name));
  const findMilestone = (filePh: Phase, m: Milestone) =>
    filePh.milestones.find((fm) => fm.id === m.id) ??
    filePh.milestones.find((fm) => normText(fm.text) === normText(m.text));

  const merged = cached.map((ph) => {
    const filePh = findPhase(ph);
    if (!filePh) return ph;
    const milestones = ph.milestones.map((m) => {
      const fileM = findMilestone(filePh, m);
      return fileM && fileM.done && !m.done ? { ...m, done: true } : m;
    });
    const matchedFileIds = new Set(
      ph.milestones.map((m) => findMilestone(filePh, m)?.id).filter((id): id is string => !!id),
    );
    for (const fm of filePh.milestones) {
      if (!matchedFileIds.has(fm.id)) milestones.push(fm);
    }
    return { ...ph, milestones };
  });
  const matchedFilePhaseIds = new Set(
    cached.map((ph) => findPhase(ph)?.id).filter((id): id is string => !!id),
  );
  for (const filePh of file) {
    if (!matchedFilePhaseIds.has(filePh.id)) merged.push(filePh);
  }
  // Vangnet: mocht er ondanks de naam-matching toch een duplicaat ontstaan
  // (bijv. omdat Claude de fase-/mijlpaalnaam licht herformuleerde), ruim dat
  // hier meteen op i.p.v. het door te laten sluipen naar de cache.
  return dedupeRoadmap(merged);
}

/**
 * Neemt de roadmap uit `.projectradar.json` over als bron van waarheid voor de
 * **structuur**: volgorde, namen, toevoegingen én verwijderingen.
 *
 * Dit is bewust scherper dan `reconcileRoadmap`, dat bij elke scan draait en
 * juist de cache laat winnen zodat handmatige bewerkingen niet zomaar
 * verdampen. Het gevolg daarvan is dat een door Claude hérschreven roadmap
 * (fase hernoemd, afgeronde mijlpaal opgeruimd) niet doorkomt: je blijft de
 * oude structuur zien. Deze functie hangt daarom aan een expliciete knop —
 * de gebruiker vraagt er zelf om, dus mag het bestand winnen.
 *
 * Twee dingen blijven wel behouden, want die bestaan alleen in de app en zou
 * je anders stilzwijgend kwijtraken:
 * - voortgang gaat nooit terug (een `done` in de cache blijft `done`);
 * - `onHold`, `scheduledAt` en `target` komen uit de cache als het bestand ze
 *   niet zelf invult.
 */
export function refreshRoadmapFromFile(cached: Phase[], file: Phase[]): Phase[] {
  const findCachedPhase = (ph: Phase) =>
    cached.find((c) => c.id === ph.id) ?? cached.find((c) => normText(c.name) === normText(ph.name));

  const merged = file.map((filePh) => {
    const cachedPh = findCachedPhase(filePh);
    if (!cachedPh) return filePh;
    const findCachedMs = (m: Milestone) =>
      cachedPh.milestones.find((c) => c.id === m.id) ??
      cachedPh.milestones.find((c) => normText(c.text) === normText(m.text));
    return {
      ...filePh,
      target: filePh.target ?? cachedPh.target,
      onHold: filePh.onHold ?? cachedPh.onHold,
      scheduledAt: filePh.scheduledAt ?? cachedPh.scheduledAt,
      milestones: filePh.milestones.map((m) => {
        const c = findCachedMs(m);
        return c?.done && !m.done ? { ...m, done: true } : m;
      }),
    };
  });
  return dedupeRoadmap(merged);
}

/**
 * Voeg de handmatige meta (localStorage-cache) en een `.projectradar.json` uit
 * de repo samen. Het bestand is een **seed**: het vult alleen velden die nog
 * leeg zijn in de cache, en overschrijft nooit een bestaande handmatige waarde.
 * Zo verrijkt een nieuw project automatisch, maar verliest een in de UI bewerkt
 * project bij de volgende scan zijn wijziging niet. Dezelfde regel als
 * `upsertProject` in sync.ts, zodat lokaal en cloud niet uit elkaar lopen.
 */
function mergeMeta(key: string, cached: ProjectMeta, file: RepoInfo["radar_meta"]): ProjectMeta {
  const merged: ProjectMeta = { ...cached, key };
  if (!file) return merged;

  if (file.description != null && !merged.description) merged.description = file.description;
  // "idee" is de default-status, dus seedbaar; een bewuste andere status blijft.
  if (file.status != null && (merged.status == null || merged.status === "idee")) {
    merged.status = file.status;
  }
  if (file.stack != null && !merged.stack?.length) merged.stack = file.stack;
  if (file.roadmap != null) {
    const fileRoadmap = normalizeRoadmap(file.roadmap as unknown[]);
    merged.roadmap = merged.roadmap?.length ? reconcileRoadmap(merged.roadmap, fileRoadmap) : fileRoadmap;
  }
  if (file.runCommand != null && !merged.runCommand) merged.runCommand = file.runCommand;
  if (file.devUrl != null && !merged.devUrl) merged.devUrl = file.devUrl;
  if (file.claudeInstructions != null && !merged.claudeInstructions) {
    merged.claudeInstructions = file.claudeInstructions;
  }
  if (file.designInstructions != null && !merged.designInstructions) {
    merged.designInstructions = file.designInstructions;
  }
  // Links per sub-veld seeden, zodat een handmatig ingevulde repo- of deploy-URL
  // blijft staan terwijl de andere nog uit het bestand kan komen.
  if (file.links != null) {
    const repo = merged.links?.repo || file.links.repo;
    const deploy = merged.links?.deploy || file.links.deploy;
    if (repo || deploy) merged.links = { repo, deploy };
  }
  return merged;
}

/** Bouw het samengevoegde projectbeeld uit een scan op deze PC. */
export function buildProjects(
  repos: RepoInfo[],
  metaAll: Record<string, ProjectMeta>,
  machine: string,
): Project[] {
  const map = new Map<string, Project>();

  for (const r of repos) {
    const key = projectKey(r.name);
    const state: PcState = {
      machine,
      path: r.path,
      branch: r.branch,
      detached: r.detached,
      lastCommitDate: r.last_commit_date,
      lastCommitHash: r.last_commit_hash,
      totalCommits: r.total_commits,
      weeklyCommits: r.weekly_commits,
      hasUncommitted: r.has_uncommitted,
      ahead: r.ahead,
      behind: r.behind,
      isThisPc: true,
    };

    const existing = map.get(key);
    if (existing) {
      existing.states.push(state);
      for (const t of r.detected_stack) {
        if (!existing.detectedStack.includes(t)) existing.detectedStack.push(t);
      }
      if (!existing.remoteUrl) existing.remoteUrl = r.remote_url;
      if (!existing.defaultRunCommand) existing.defaultRunCommand = r.default_run_command;
      if (!existing.defaultDevUrl) existing.defaultDevUrl = r.default_dev_url;
    } else {
      map.set(key, {
        key,
        name: r.name,
        meta: mergeMeta(key, metaAll[key] ?? { key }, r.radar_meta),
        states: [state],
        detectedStack: [...r.detected_stack],
        remoteUrl: r.remote_url,
        defaultRunCommand: r.default_run_command,
        defaultDevUrl: r.default_dev_url,
      });
    }
  }

  return [...map.values()];
}

/** Handmatige stack heeft voorrang, anders de gedetecteerde. */
export function effectiveStack(p: Project): string[] {
  if (p.meta.stack && p.meta.stack.length) return p.meta.stack;
  return p.detectedStack;
}

export function statusOf(p: Project): Status {
  return p.meta.status ?? "idee";
}

export interface RoadmapProgress {
  done: number;
  total: number;
  pct: number;
}

/** Voortgang over alle mijlpalen in de roadmap; null als er geen mijlpalen zijn. */
export function roadmapProgress(p: Project): RoadmapProgress | null {
  let done = 0;
  let total = 0;
  for (const phase of p.meta.roadmap ?? []) {
    for (const m of phase.milestones) {
      total++;
      if (m.done) done++;
    }
  }
  if (total === 0) return null;
  return { done, total, pct: Math.round((done / total) * 100) };
}

/**
 * Sorteervolgorde voor de handmatige dashboardstand. Projecten zonder rang
 * (nooit gesleept) zakken naar onderen en staan daar op naam.
 */
export function byRank(a: Project, b: Project): number {
  const ra = a.meta.rank ?? Number.MAX_SAFE_INTEGER;
  const rb = b.meta.rank ?? Number.MAX_SAFE_INTEGER;
  return ra !== rb ? ra - rb : a.name.localeCompare(b.name);
}

/**
 * Verplaatst `dragKey` naar de positie van `targetKey` en geeft de nieuwe
 * volgorde van álle projecten terug (index = rang).
 *
 * Herschikt bewust over de volledige lijst en niet over wat zichtbaar is:
 * staat er een filter of zoekterm aan, dan zou werken met alleen de zichtbare
 * kaarten de verborgen projecten hun onderlinge volgorde laten verliezen.
 */
export function reorderProjects(projects: Project[], dragKey: string, targetKey: string): string[] {
  const ordered = [...projects].sort(byRank);
  const from = ordered.findIndex((p) => p.key === dragKey);
  const to = ordered.findIndex((p) => p.key === targetKey);
  if (from < 0 || to < 0 || from === to) return ordered.map((p) => p.key);
  const [moved] = ordered.splice(from, 1);
  ordered.splice(to, 0, moved);
  return ordered.map((p) => p.key);
}

/** De lokale stand (deze PC), waarvandaan we kunnen launchen. */
export function localState(p: Project) {
  return p.states.find((s) => s.isThisPc) ?? null;
}

/** Stand met de nieuwste commit, ongeacht machine; null als er geen states zijn. */
export function newestState(p: Project): PcState | null {
  if (!p.states.length) return null;
  return [...p.states].sort((a, b) => {
    const ta = a.lastCommitDate ? new Date(a.lastCommitDate).getTime() : 0;
    const tb = b.lastCommitDate ? new Date(b.lastCommitDate).getTime() : 0;
    return tb - ta;
  })[0];
}

/** Pad op deze PC, of null als het project hier niet staat. */
export function localPath(p: Project): string | null {
  return localState(p)?.path ?? null;
}

/** Effectief start-commando: handmatig veld > auto-detectie > npm run dev. */
export function runCommandOf(p: Project): string {
  return p.meta.runCommand?.trim() || p.defaultRunCommand || "npm run dev";
}

/**
 * Effectieve dev-URL die na het starten in de browser opent: handmatig veld >
 * auto-detectie. Leeg/null = geen browser openen.
 */
export function devUrlOf(p: Project): string | null {
  return p.meta.devUrl?.trim() || p.defaultDevUrl || null;
}

/**
 * Stel het eerste bericht voor Claude samen: projectcontext + de huidige roadmap
 * (met afgevinkte/openstaande mijlpalen) + de instructie van de gebruiker.
 */
export function buildClaudePrompt(p: Project, instruction: string): string {
  const lines: string[] = [];
  lines.push(`Je werkt mee aan het project "${p.name}".`);

  const desc = p.meta.description?.trim();
  if (desc) lines.push("", desc);

  const phases = p.meta.roadmap ?? [];
  if (phases.length) {
    lines.push("", "Roadmap (huidige stand):");
    for (const ph of phases) {
      const done = ph.milestones.filter((m) => m.done).length;
      const target = ph.target ? `, streef: ${ph.target}` : "";
      lines.push(`\n## ${ph.name} (${done}/${ph.milestones.length}${target}) [id: ${ph.id}]`);
      for (const m of ph.milestones) {
        lines.push(`- [${m.done ? "x" : " "}] ${m.text} [id: ${m.id}]`);
      }
    }
    lines.push(
      "",
      "Belangrijk voor `.projectradar.json`: hergebruik de [id]'s hierboven exact",
      "wanneer je een bestaande fase/mijlpaal bijwerkt. Verzin alleen een nieuwe",
      "kebab-case id voor een fase/mijlpaal die je zelf toevoegt — een andere id",
      "gebruiken voor iets dat al bestaat plakt een duplicaat onder de roadmap",
      "in plaats van 'm bij te werken.",
    );
  }

  lines.push("", "Opdracht:");
  lines.push(
    instruction.trim() ||
      "Pak de eerstvolgende openstaande mijlpaal op en werk die uit. Stel eerst een kort plan voor.",
  );

  if (phases.length) {
    lines.push(
      "",
      "Zodra je een mijlpaal of hele fase hebt afgerond: werk de roadmap in",
      "`.projectradar.json` bij (zet `\"done\": true` op de juiste id, zie hierboven)",
      "voordat je stopt — ook als daar niet expliciet om is gevraagd.",
    );
  }
  return lines.join("\n");
}

/**
 * Instructie voor Claude om de roadmap te (laten) genereren of te checken.
 * `buildClaudePrompt` voegt de bestaande roadmap als context toe, dus bij een
 * check ziet Claude die al staan; bij genereren is er nog niets.
 */
export function buildRoadmapInstruction(p: Project): string {
  const hasRoadmap = (p.meta.roadmap ?? []).some((ph) => ph.milestones.length > 0);
  const custom = p.meta.claudeInstructions?.trim();
  const customBlock = custom
    ? ["Project-specifieke instructies (door de gebruiker ingesteld, hebben voorrang):", custom, ""]
    : [];

  if (!hasRoadmap) {
    return [
      ...customBlock,
      "Er is nog geen roadmap voor dit project. Onderzoek eerst zelfstandig de repo",
      "(README, package.json/Cargo.toml/pyproject.toml, mappenstructuur, `git log --oneline -20`)",
      "om te bepalen wat er al is en waar dit project heen moet.",
      "",
      "Stel me, als iets essentieels ontbreekt om een goede roadmap te maken",
      "(doel, doelgroep, tijdshorizon), eerst 1-3 gerichte vragen voordat je verder gaat.",
      "",
      "Maak daarna een realistische roadmap van 3-6 fasen met elk 3-8 concrete,",
      "afvinkbare mijlpalen. Markeer mijlpalen als klaar (`done: true`) alleen als",
      "daar bewijs voor is in de code/commits — verzin geen voortgang.",
      "",
      "Gebruik exact dit JSON-schema (veld `text`, NIET `description`/`label`/`title`/`name`):",
      '  fase:     { "id": "kebab-id", "name": "Fasenaam", "milestones": [...] }',
      '  mijlpaal: { "id": "kebab-id", "text": "Beschrijving", "done": false }',
      "",
      "Schrijf de roadmap direct in het `roadmap`-veld van `.projectradar.json` in de",
      "projectroot (overige velden mag je aanvullen, maar niet overschrijven als ze",
      "al ingevuld zijn). Sluit af met een korte samenvatting van de fasen.",
    ].join("\n");
  }

  return [
    ...customBlock,
    "Controleer de roadmap hierboven aan de hand van de daadwerkelijke stand van de",
    "code en `git log --oneline -20`: welke mijlpalen zijn eigenlijk al klaar maar",
    "staan nog open, welke zijn achterhaald of niet meer relevant, en ontbreekt er",
    "iets essentieels?",
    "",
    "Werk `.projectradar.json` direct bij zodat de roadmap de actuele stand toont:",
    "vink mijlpalen af die al klaar zijn, verwijder/herformuleer wat achterhaald is,",
    "en vul ontbrekende mijlpalen aan. Overschrijf geen mijlpalen die je niet hebt",
    "kunnen verifiëren zonder reden. Vraag alleen tussentijds iets aan mij als je",
    "twijfelt over richting of prioriteit.",
    "",
    "Sluit af met een korte samenvatting van wat je hebt aangepast en waarom.",
  ].join("\n");
}

/**
 * Eerste fase (sprint) met nog openstaande mijlpalen, in roadmap-volgorde;
 * fasen die on hold staan worden overgeslagen. Null als alles klaar/on hold is.
 */
export function nextOpenPhase(phases: Phase[]): { phase: Phase; milestones: Milestone[] } | null {
  for (const phase of phases) {
    if (phase.onHold) continue;
    const open = phase.milestones.filter((m) => !m.done);
    if (open.length > 0) return { phase, milestones: open };
  }
  return null;
}

/**
 * Instructie om één specifieke sprint/fase volledig uit te werken, los van
 * haar positie in de roadmap. Gebruikt door zowel "Pak de sprint op" (voor de
 * eerstvolgende open fase) als geplande sprint-starts (voor een aangewezen fase).
 */
export function buildPhasePrompt(phase: Phase): string {
  const open = phase.milestones.filter((m) => !m.done);
  const milestones = open.length ? open : phase.milestones;
  return [
    "Pak de draad op. Werk de volgende sprint volledig uit:",
    "",
    `Fase: ${phase.name}`,
    "Openstaande mijlpalen:",
    ...milestones.map((m) => `- ${m.text}`),
    "",
    "Analyseer de huidige stand van de code en implementeer deze mijlpalen één voor één.",
    'Vink elke mijlpaal af in `.projectradar.json` (zet `"done": true`) zodra hij klaar is.',
  ].join("\n");
}

/**
 * Prompt voor "Pak de draad op": focust Claude direct op de eerstvolgende
 * actieve sprint/fase (alle openstaande mijlpalen erin), zonder preamble of
 * planningsvragen. Fasen die on hold staan worden overgeslagen.
 */
export function buildPickUpPrompt(p: Project): string {
  const next = nextOpenPhase(p.meta.roadmap ?? []);
  if (!next) {
    return "Alle actieve fasen in de roadmap zijn afgerond of staan on hold. Bekijk de code en stel voor wat een zinvolle volgende stap zou zijn.";
  }
  return buildPhasePrompt(next.phase);
}

export interface ScheduleEntry {
  id: string;
  projectKey: string;
  projectPath: string;
  phaseName: string;
  milestones: string[];
  scheduledAtMs: number;
}

/** Stabiel id voor een geplande fase, gedeeld tussen frontend en Rust-scheduler. */
export function scheduleIdOf(projectKey: string, phaseId: string): string {
  return `${projectKey}:${phaseId}`;
}

/**
 * Bouw de compacte snapshot die naar de Rust-scheduler gaat zodra een fase een
 * `scheduledAt` heeft. Null als er niets (meer) te plannen valt (geen lokaal
 * pad, of geen geldige datum) — de aanroeper moet dan `schedule_clear` doen.
 */
export function buildScheduleEntry(p: Project, phase: Phase): ScheduleEntry | null {
  const path = localPath(p);
  if (!path || !phase.scheduledAt) return null;
  const at = new Date(phase.scheduledAt).getTime();
  if (Number.isNaN(at)) return null;
  const open = phase.milestones.filter((m) => !m.done);
  const milestones = (open.length ? open : phase.milestones).map((m) => m.text);
  return {
    id: scheduleIdOf(p.key, phase.id),
    projectKey: p.key,
    projectPath: path,
    phaseName: phase.name,
    milestones,
    scheduledAtMs: at,
  };
}

/** Zet een mijlpaal aan/uit in de roadmap van deze meta, immutable. */
export function toggleMilestone(meta: ProjectMeta, phaseId: string, msId: string, done: boolean): ProjectMeta {
  const roadmap = (meta.roadmap ?? []).map((ph) =>
    ph.id === phaseId
      ? { ...ph, milestones: ph.milestones.map((m) => (m.id === msId ? { ...m, done } : m)) }
      : ph,
  );
  return { ...meta, roadmap };
}

/**
 * Instructie voor Claude om de code te checken op netheid, onderhoudbaarheid
 * en veiligheid. Zelfde patroon als `buildRoadmapInstruction`.
 */
export function buildCodeCheckInstruction(p: Project): string {
  const custom = p.meta.claudeInstructions?.trim();
  const customBlock = custom
    ? ["Project-specifieke instructies (door de gebruiker ingesteld, hebben voorrang):", custom, ""]
    : [];
  return [
    ...customBlock,
    "Doe een code-review van dit project: netheid, onderhoudbaarheid en veiligheid.",
    "",
    "Controleer onder andere:",
    "- Code-smells: dode code, duplicatie, te grote functies/bestanden, onduidelijke naamgeving.",
    "- Veiligheid: injectie (SQL/command/XSS), onveilige opslag van secrets/tokens, ontbrekende",
    "  input-validatie op vertrouwensgrenzen, onveilige afhankelijkheden.",
    "- Consistentie met de rest van de codebase (patronen, conventies, types).",
    "",
    "Rapporteer de bevindingen gegroepeerd op ernst (kritiek/matig/nice-to-have), met bestandsnaam",
    "en regelnummer. Fix alleen kleine, evidente problemen direct; stel grotere wijzigingen eerst",
    "voor voordat je ze doorvoert. Sluit af met een korte samenvatting.",
  ].join("\n");
}

/**
 * Instructie voor Claude om de UI/UX en visuele vormgeving te checken.
 * Zelfde patroon als `buildCodeCheckInstruction`.
 */
export function buildDesignCheckInstruction(p: Project): string {
  const custom = (p.meta.designInstructions?.trim() || p.meta.claudeInstructions?.trim());
  const customBlock = custom
    ? ["Project-specifieke instructies (door de gebruiker ingesteld, hebben voorrang):", custom, ""]
    : [];
  return [
    ...customBlock,
    "Doe een review van de UI/UX en visuele vormgeving van dit project. De twee",
    "belangrijkste dingen om op te letten:",
    "",
    "1. Visuele consistentie — kleuren, spacing, typografie, randen/schaduwen en",
    "   componenten (knoppen, panelen, badges, formuliervelden) die afwijken van het",
    "   patroon dat elders in de app al gebruikt wordt. Gebruikt dit scherm dezelfde",
    "   design-tokens/CSS-variabelen en componentklassen als de rest, of zijn er",
    "   losstaande, opnieuw uitgevonden stijlen?",
    "2. Informatiedichtheid en overzicht — voelt een scherm rommelig of overweldigend",
    "   aan? Is de belangrijkste informatie in één oogopslag te zien, of verdrinkt die",
    "   tussen minder relevante details? Denk aan groepering, hiërarchie (wat springt",
    "   eruit, wat niet), en of secundaire info ingeklapt/verborgen zou moeten zijn.",
    "",
    "Neem daarnaast kort mee, maar met lagere prioriteit:",
    "- Toegankelijkheid: contrast, focus-states, labels, toetsenbordbediening.",
    "- Dark/light thema: geen hardcoded kleuren die het thema breken.",
    "- Bruikbaarheid: verwarrende flows, ontbrekende feedback/loading-states.",
    "",
    "Rapporteer de bevindingen gegroepeerd op prioriteit, met concrete plek (bestand/component) en",
    "voorstel. Fix alleen kleine, evidente problemen direct; stel grotere wijzigingen eerst voor",
    "voordat je ze doorvoert. Sluit af met een korte samenvatting.",
  ].join("\n");
}

/** Haal het poortnummer uit een URL (default 80/443 als niet vermeld). */
export function portFromUrl(url: string): number | null {
  try {
    const u = new URL(url);
    if (u.port) return Number(u.port);
    return u.protocol === "https:" ? 443 : 80;
  } catch {
    return null;
  }
}

export interface PcComparison {
  inSync: boolean;
  /** Machine met de meest recente commit (de "voorloper"). */
  leadMachine: string | null;
  message: string | null;
}

/**
 * Vergelijk de git-stand over PC's heen. Gelijke laatste-commit-hash = in sync;
 * anders loopt de PC met de jongste commit voor (conform PRD: op hash/datum).
 */
export function compareStates(p: Project): PcComparison {
  if (p.states.length < 2) return { inSync: true, leadMachine: null, message: null };

  const hashes = new Set(p.states.map((s) => s.lastCommitHash ?? "?"));
  if (hashes.size === 1) {
    return { inSync: true, leadMachine: null, message: null };
  }

  const sorted = [...p.states].sort((a, b) => {
    const ta = a.lastCommitDate ? new Date(a.lastCommitDate).getTime() : 0;
    const tb = b.lastCommitDate ? new Date(b.lastCommitDate).getTime() : 0;
    return tb - ta;
  });
  const lead = sorted[0];
  const others = sorted.slice(1).map((s) => s.machine).join(", ");
  return {
    inSync: false,
    leadMachine: lead.machine,
    message: `${others} loopt achter op ${lead.machine}`,
  };
}

/**
 * Compacte JSON-snapshot voor de externe (Tailscale) bediening: alles wat de
 * mobiele pagina nodig heeft om status te tonen en acties aan te bieden, in
 * één klap doorgegeven aan de Rust-cache via `push_remote_state`. Bevat geen
 * lokale paden of andere per-PC-details die niet relevant zijn op afstand.
 */
export function buildRemoteSnapshot(projects: Project[], claudeByKey: Record<string, ClaudeState>) {
  return {
    updatedAt: new Date().toISOString(),
    projects: projects.map((p) => {
      // Bij voorkeur de stand van deze PC (daar draait Claude ook); staat het
      // project hier niet, dan de machine met de nieuwste commit.
      const st = localState(p) ?? newestState(p);
      const cmp = compareStates(p);
      return {
        key: p.key,
        name: p.name,
        status: statusOf(p),
        claude: claudeByKey[p.key] ?? null,
        canLaunch: !!localPath(p),
        progress: roadmapProgress(p),
        git: st
          ? {
              machine: st.machine,
              isThisPc: st.isThisPc,
              branch: st.branch,
              detached: st.detached,
              hasUncommitted: st.hasUncommitted,
              ahead: st.ahead,
              behind: st.behind,
              lastCommitDate: st.lastCommitDate,
              // Alleen de korte hash — genoeg om twee machines te vergelijken.
              lastCommitHash: st.lastCommitHash ? st.lastCommitHash.slice(0, 7) : null,
              weeklyCommits: st.weeklyCommits,
            }
          : null,
        // Alleen gevuld als de PC's uit elkaar lopen; anders niets te melden.
        sync: cmp.inSync ? null : { message: cmp.message, leadMachine: cmp.leadMachine },
        phases: (p.meta.roadmap ?? []).map((ph) => ({
          id: ph.id,
          name: ph.name,
          onHold: !!ph.onHold,
          milestones: ph.milestones.map((m) => ({ id: m.id, text: m.text, done: m.done })),
        })),
        history: (p.meta.history ?? []).slice(0, 5),
      };
    }),
  };
}
