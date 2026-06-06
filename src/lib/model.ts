import type { Project, ProjectMeta, RepoInfo, PcState, Status } from "../types";
import { projectKey } from "./format";

/**
 * Voeg de handmatige meta (localStorage-cache) en een `.projectradar.json` uit
 * de repo samen. Het bestand wint per ingevuld veld, zodat opnieuw genereren de
 * radar automatisch verrijkt; de cache vult alleen aan wat het bestand weglaat.
 */
function mergeMeta(key: string, cached: ProjectMeta, file: RepoInfo["radar_meta"]): ProjectMeta {
  const merged: ProjectMeta = { ...cached, key };
  if (!file) return merged;
  if (file.description != null) merged.description = file.description;
  if (file.status != null) merged.status = file.status;
  if (file.stack != null) merged.stack = file.stack;
  if (file.links != null) merged.links = file.links;
  if (file.roadmap != null) merged.roadmap = file.roadmap;
  if (file.runCommand != null) merged.runCommand = file.runCommand;
  if (file.devUrl != null) merged.devUrl = file.devUrl;
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

/** De lokale stand (deze PC), waarvandaan we kunnen launchen. */
export function localState(p: Project) {
  return p.states.find((s) => s.isThisPc) ?? null;
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
      lines.push(`\n## ${ph.name} (${done}/${ph.milestones.length}${target})`);
      for (const m of ph.milestones) {
        lines.push(`- [${m.done ? "x" : " "}] ${m.text}`);
      }
    }
  }

  lines.push("", "Opdracht:");
  lines.push(
    instruction.trim() ||
      "Pak de eerstvolgende openstaande mijlpaal op en werk die uit. Stel eerst een kort plan voor.",
  );
  return lines.join("\n");
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
