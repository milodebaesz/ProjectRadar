import { pb } from "./pocketbase";
import type { MachineInfo, PcState, Project, ProjectMeta, RepoInfo, Status } from "../types";
import { projectKey } from "./format";

// Push (lokale scan → cloud) en pull (cloud → overzicht) tegen PocketBase.
// De roadmap en handmatige velden leven als velden op het `projects`-record;
// de per-PC git-stand in `project_states`.

function userId(): string {
  const id = pb.authStore.record?.id;
  if (!id) throw new Error("Niet ingelogd");
  return id;
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
    has_uncommitted: repo.has_uncommitted,
    ahead: repo.ahead,
    behind: repo.behind,
    local_path: repo.path,
  };
  if (found.length) return pb.collection("project_states").update(found[0].id, data);
  return pb.collection("project_states").create(data);
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
      hasUncommitted: !!s.has_uncommitted,
      ahead: s.ahead || 0,
      behind: s.behind || 0,
      isThisPc,
    };
    const arr = byProject.get(s.project) ?? [];
    arr.push(st);
    byProject.set(s.project, arr);
  }

  return projects.map((p) => {
    const stack: string[] = Array.isArray(p.stack) ? p.stack : [];
    const meta: ProjectMeta = {
      key: p.key,
      description: p.description || undefined,
      status: (p.status || "idee") as Status,
      stack: stack.length ? stack : undefined,
      links: { repo: p.repo_url || undefined, deploy: p.deploy_url || undefined },
      roadmap: Array.isArray(p.roadmap) ? p.roadmap : [],
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
  });
}
