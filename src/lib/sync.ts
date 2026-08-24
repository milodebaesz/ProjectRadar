import { pb } from "./pocketbase";
import type { HistoryEntry, MachineInfo, PcState, Project, ProjectMeta, RepoInfo, Status } from "../types";
import { projectKey } from "./format";
import { normalizeRoadmap } from "./model";
import { loadAllMeta } from "./storage";

// Push (lokale scan → cloud) en pull (cloud → overzicht) tegen PocketBase.
// De roadmap en handmatige velden leven als velden op het `projects`-record;
// de per-PC git-stand in `project_states`.

function userId(): string {
  const id = pb.authStore.record?.id;
  if (!id) throw new Error("Niet ingelogd");
  return id;
}

/**
 * Kies tussen de cloud-waarde en de lokale cache voor één veld.
 *
 * Alleen terugvallen op de cache als de sleutel écht ontbreekt in het record.
 * PocketBase geeft precies de velden terug die in het schema staan, dus
 * `undefined` betekent hier "deze PocketBase draait nog een oudere
 * `setup.mjs`" — en dan is de cache het enige dat de waarde nog heeft.
 * Een veld dat wél bestaat maar leeg is, is een bewuste wis op een andere
 * PC en wint dus gewoon; anders zou een gewist veld telkens terugkomen.
 */
function pick<T>(cloud: T | undefined, cached: T | undefined): T | undefined {
  return cloud === undefined ? cached : cloud;
}

async function upsertMachine(info: MachineInfo, label: string): Promise<string> {
  const found = await pb
    .collection("machines")
    .getFullList({ filter: pb.filter("hostname = {:h}", { h: info.hostname }) });
  const data = {
    user: userId(),
    hostname: info.hostname,
    label: label || info.hostname,
    os: info.os,
    last_seen: new Date().toISOString(),
  };
  if (found.length) {
    return (await pb.collection("machines").update(found[0].id, data)).id;
  }
  return (await pb.collection("machines").create(data)).id;
}

async function upsertProject(repo: RepoInfo, key: string): Promise<string> {
  const found = await pb
    .collection("projects")
    .getFullList({ filter: pb.filter("key = {:k}", { k: key }) });

  // Velden uit een `.projectradar.json` in de repo, indien aanwezig.
  const file = repo.radar_meta ?? null;

  if (found.length) {
    const existing = found[0];
    const patch: Record<string, unknown> = { name: repo.name };
    if (repo.remote_url) patch.remote_url = repo.remote_url;
    // Vul lege velden automatisch vanuit het bestand; bestaande (handmatige)
    // waarden in de cloud blijven staan.
    if (file) {
      if (file.description && !existing.description) patch.description = file.description;
      if (file.status && (!existing.status || existing.status === "idee")) patch.status = file.status;
      if (file.roadmap?.length && !(Array.isArray(existing.roadmap) && existing.roadmap.length)) {
        patch.roadmap = file.roadmap;
      }
      if (file.links?.repo && !existing.repo_url) patch.repo_url = file.links.repo;
      if (file.links?.deploy && !existing.deploy_url) patch.deploy_url = file.links.deploy;
      if (file.runCommand && !existing.run_command) patch.run_command = file.runCommand;
      if (file.devUrl && !existing.dev_url) patch.dev_url = file.devUrl;
      if (file.claudeInstructions && !existing.claude_instructions) {
        patch.claude_instructions = file.claudeInstructions;
      }
      if (file.designInstructions && !existing.design_instructions) {
        patch.design_instructions = file.designInstructions;
      }
    }
    // Stack: bestand heeft voorrang, anders gedetecteerd — alleen als nog leeg.
    const curStack = Array.isArray(existing.stack) ? existing.stack : [];
    if (curStack.length === 0) {
      if (file?.stack?.length) patch.stack = file.stack;
      else if (repo.detected_stack.length) patch.stack = repo.detected_stack;
    }
    return (await pb.collection("projects").update(existing.id, patch)).id;
  }

  return (
    await pb.collection("projects").create({
      user: userId(),
      key,
      name: repo.name,
      description: file?.description ?? "",
      status: file?.status ?? "idee",
      stack: file?.stack?.length ? file.stack : repo.detected_stack,
      roadmap: file?.roadmap ?? [],
      repo_url: file?.links?.repo ?? "",
      deploy_url: file?.links?.deploy ?? "",
      remote_url: repo.remote_url ?? "",
      run_command: file?.runCommand ?? "",
      dev_url: file?.devUrl ?? "",
      claude_instructions: file?.claudeInstructions ?? "",
      design_instructions: file?.designInstructions ?? "",
      history: [],
    })
  ).id;
}

async function upsertState(projectId: string, machineId: string, repo: RepoInfo) {
  const found = await pb
    .collection("project_states")
    .getFullList({
      filter: pb.filter("project = {:p} && machine = {:m}", { p: projectId, m: machineId }),
    });
  const data = {
    project: projectId,
    machine: machineId,
    branch: repo.branch ?? "",
    detached: repo.detached,
    last_commit_hash: repo.last_commit_hash ?? "",
    last_commit_date: repo.last_commit_date ?? "",
    total_commits: repo.total_commits,
    weekly_commits: repo.weekly_commits,
    has_uncommitted: repo.has_uncommitted,
    ahead: repo.ahead,
    behind: repo.behind,
    local_path: repo.path,
  };
  if (found.length) return pb.collection("project_states").update(found[0].id, data);
  return pb.collection("project_states").create(data);
}

/**
 * Volledige cloud-ronde voor één scan: push deze PC naar de cloud, haal het
 * gecombineerde overzicht weer op, en plak de lokaal gedetecteerde stack/
 * start-commando/dev-URL terug (die leven niet in de cloud, alleen op deze PC).
 */
export async function syncScan(
  repos: RepoInfo[],
  info: MachineInfo,
  label: string,
): Promise<Project[]> {
  await pushScan(repos, info, label);
  const cloud = await fetchProjects(info.hostname);
  const det = new Map(repos.map((r) => [projectKey(r.name), r.detected_stack]));
  const runCmd = new Map(repos.map((r) => [projectKey(r.name), r.default_run_command]));
  const devUrl = new Map(repos.map((r) => [projectKey(r.name), r.default_dev_url]));
  for (const p of cloud) {
    p.detectedStack = det.get(p.key) ?? [];
    p.defaultRunCommand = runCmd.get(p.key) ?? null;
    p.defaultDevUrl = devUrl.get(p.key) ?? null;
  }
  return cloud;
}

/** Schrijf de scan van deze PC weg naar de cloud. */
export async function pushScan(repos: RepoInfo[], info: MachineInfo, label: string) {
  const machineId = await upsertMachine(info, label);
  const doneKeys = new Set<string>();
  for (const repo of repos) {
    const key = projectKey(repo.name);
    const projectId = await upsertProject(repo, key);
    await upsertState(projectId, machineId, repo);
    doneKeys.add(key);
  }
}

/** Haal alle projecten + per-PC standen op en bouw het overzicht. */
export async function fetchProjects(thisHostname: string): Promise<Project[]> {
  const [projects, states] = await Promise.all([
    pb.collection("projects").getFullList(),
    pb.collection("project_states").getFullList({ expand: "machine" }),
  ]);

  const byProject = new Map<string, PcState[]>();
  for (const s of states) {
    const m = s.expand?.machine;
    const isThisPc = m?.hostname === thisHostname;
    const st: PcState = {
      machine: m?.label || m?.hostname || "PC",
      // Pad alleen bruikbaar voor launchen op deze PC zelf.
      path: isThisPc ? s.local_path || null : null,
      branch: s.branch || null,
      detached: !!s.detached,
      lastCommitDate: s.last_commit_date || null,
      lastCommitHash: s.last_commit_hash || null,
      totalCommits: s.total_commits || 0,
      weeklyCommits: s.weekly_commits || 0,
      hasUncommitted: !!s.has_uncommitted,
      ahead: s.ahead || 0,
      behind: s.behind || 0,
      isThisPc,
    };
    const arr = byProject.get(s.project) ?? [];
    arr.push(st);
    byProject.set(s.project, arr);
  }

  // Lokale cache als vangnet voor velden die deze PocketBase (nog) niet kent.
  const cachedAll = loadAllMeta();

  return projects.map((p) => {
    const stack: string[] = Array.isArray(p.stack) ? p.stack : [];
    const cached = cachedAll[p.key] ?? ({ key: p.key } as ProjectMeta);
    const history = pick<unknown>(p.history, cached.history);
    const meta: ProjectMeta = {
      key: p.key,
      description: p.description || undefined,
      status: (p.status || "idee") as Status,
      stack: stack.length ? stack : undefined,
      links: { repo: p.repo_url || undefined, deploy: p.deploy_url || undefined },
      roadmap: Array.isArray(p.roadmap) ? normalizeRoadmap(p.roadmap) : [],
      rank: typeof p.rank === "number" && p.rank >= 0 ? p.rank : undefined,
      runCommand: pick(p.run_command, cached.runCommand) || undefined,
      devUrl: pick(p.dev_url, cached.devUrl) || undefined,
      claudeInstructions: pick(p.claude_instructions, cached.claudeInstructions) || undefined,
      designInstructions: pick(p.design_instructions, cached.designInstructions) || undefined,
      history: Array.isArray(history) ? (history as HistoryEntry[]) : undefined,
    };
    return {
      key: p.key,
      name: p.name,
      meta,
      states: byProject.get(p.id) ?? [],
      detectedStack: [],
      remoteUrl: p.remote_url || null,
    };
  });
}

/** Verwijder een project + al zijn per-PC standen uit de cloud. */
export async function deleteProjectFromCloud(key: string) {
  const found = await pb
    .collection("projects")
    .getFullList({ filter: pb.filter("key = {:k}", { k: key }) });
  for (const project of found) {
    const states = await pb
      .collection("project_states")
      .getFullList({ filter: pb.filter("project = {:p}", { p: project.id }) });
    for (const s of states) {
      await pb.collection("project_states").delete(s.id);
    }
    await pb.collection("projects").delete(project.id);
  }
}

/** Schrijf bewerkte handmatige velden van één project terug naar de cloud. */
export async function saveProjectMeta(meta: ProjectMeta) {
  const found = await pb
    .collection("projects")
    .getFullList({ filter: pb.filter("key = {:k}", { k: meta.key }) });
  if (!found.length) return;
  await pb.collection("projects").update(found[0].id, {
    description: meta.description ?? "",
    status: meta.status ?? "idee",
    stack: meta.stack ?? [],
    repo_url: meta.links?.repo ?? "",
    deploy_url: meta.links?.deploy ?? "",
    roadmap: meta.roadmap ?? [],
    // -1 = "nooit gesleept"; PocketBase kent geen null voor number-velden.
    rank: meta.rank ?? -1,
    // Deze vier + history leefden eerder alleen lokaal, waardoor ze bij elke
    // scan met sync aan uit beeld verdwenen (de cloud-versie verving de
    // lokale). Ze horen bij het project, niet bij de machine, dus horen ze mee.
    run_command: meta.runCommand ?? "",
    dev_url: meta.devUrl ?? "",
    claude_instructions: meta.claudeInstructions ?? "",
    design_instructions: meta.designInstructions ?? "",
    history: meta.history ?? [],
  });
}
