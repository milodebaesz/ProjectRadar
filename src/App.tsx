import { useEffect, useMemo, useState } from "react";
import type { ClaudeState, MachineInfo, Project, ProjectMeta, ScanResult, Settings as SettingsType } from "./types";
import Sidebar, { type View } from "./components/Sidebar";
import Dashboard from "./components/Dashboard";
import SettingsView from "./components/Settings";
import ProjectDetail from "./components/ProjectDetail";
import { buildProjects, localPath, runCommandOf, devUrlOf, portFromUrl, buildClaudePrompt } from "./lib/model";
import { projectKey, uid } from "./lib/format";
import {
  isTauri,
  machineInfo as fetchMachineInfo,
  scanRoots,
  gitInit,
  pickFolder,
  openPath,
  claudeShellLine,
  claudeStatus,
  trashPath,
  waitForPort,
  openBrowser,
} from "./lib/tauri";
import TerminalDock, { type TermSpec } from "./components/TerminalDock";
import { deleteGithubRepo } from "./lib/github";
import type { DeleteOptions } from "./components/DeleteDialog";
import {
  loadSettings,
  saveSettings,
  loadAllMeta,
  saveMeta,
  loadIgnored,
  addIgnored,
  loadTheme,
  saveTheme,
} from "./lib/storage";
import {
  pbEnabled,
  currentUser,
  isLoggedIn,
  login as pbLogin,
  logout as pbLogout,
  onAuthChange,
} from "./lib/pocketbase";
import { pushScan, fetchProjects, saveProjectMeta, deleteProjectFromCloud } from "./lib/sync";

export default function App() {
  const tauri = isTauri();

  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [view, setView] = useState<View>("overzicht");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const [settings, setSettings] = useState<SettingsType>({ roots: [], machineLabel: "" });
  const [machine, setMachine] = useState<MachineInfo | null>(null);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [scanning, setScanning] = useState(false);
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [ignored, setIgnored] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(currentUser()?.email ?? null);
  const [claudeRows, setClaudeRows] = useState<Record<string, { state: string; ts: number }>>({});

  // ── Ingebouwde terminal (bottom-dock met tabs) ──
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
    openTerminal({ title: "shell", cwd: settings.roots[0] ?? "" });
  }

  const machineName = settings.machineLabel || machine?.hostname || "Deze PC";

  // ── Init ──
  useEffect(() => {
    const t = loadTheme();
    setTheme(t);
    document.documentElement.setAttribute("data-theme", t);

    const s = loadSettings();
    setSettings(s);
    setIgnored(loadIgnored());

    const unsub = onAuthChange(() => setUserEmail(currentUser()?.email ?? null));

    (async () => {
      if (tauri) {
        try {
          setMachine(await fetchMachineInfo());
        } catch {
          /* negeer */
        }
      }
      if (s.roots.length) runScan(s);
    })();

    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2800);
  }

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    saveTheme(next);
    document.documentElement.setAttribute("data-theme", next);
  }

  async function runScan(s: SettingsType = settings) {
    if (!tauri) {
      showToast("Scannen werkt alleen in de desktop-app.");
      return;
    }
    if (!s.roots.length) return;
    setScanning(true);
    try {
      const result = await scanRoots(s.roots);
      setScan(result);

      // Verwijderde projecten zijn op pad genegeerd; niet opnieuw tonen/pushen.
      const ign = loadIgnored();
      const repos = result.repos.filter((r) => !ign.includes(r.path));

      const info = machine ?? (await fetchMachineInfo().catch(() => null));
      const label = s.machineLabel || info?.hostname || "Deze PC";
      const local = buildProjects(repos, loadAllMeta(), label);

      if (isLoggedIn() && info) {
        try {
          await pushScan(repos, info, s.machineLabel);
          const cloud = await fetchProjects(info.hostname);
          // Behoud de lokaal gedetecteerde stack voor weergave.
          const det = new Map(repos.map((r) => [projectKey(r.name), r.detected_stack]));
          const runCmd = new Map(
            repos.map((r) => [projectKey(r.name), r.default_run_command]),
          );
          const devUrl = new Map(
            repos.map((r) => [projectKey(r.name), r.default_dev_url]),
          );
          cloud.forEach((p) => {
            p.detectedStack = det.get(p.key) ?? [];
            p.defaultRunCommand = runCmd.get(p.key) ?? null;
            p.defaultDevUrl = devUrl.get(p.key) ?? null;
          });
          setProjects(cloud);
        } catch (e) {
          showToast(`Cloud-sync mislukt, lokaal getoond: ${e}`);
          setProjects(local);
        }
      } else {
        setProjects(local);
      }
      setLastScan(new Date().toISOString());
    } catch (e) {
      showToast(`Scan mislukt: ${e}`);
    } finally {
      setScanning(false);
    }
  }

  function updateSettings(next: SettingsType) {
    const rootsChanged = next.roots.join("|") !== settings.roots.join("|");
    setSettings(next);
    saveSettings(next);
    if (rootsChanged) runScan(next);
  }

  function handleSaveMeta(meta: ProjectMeta) {
    saveMeta(meta); // lokale cache
    setProjects((prev) => prev.map((p) => (p.key === meta.key ? { ...p, meta } : p)));
    if (isLoggedIn()) {
      saveProjectMeta(meta).catch((e) => showToast(`Opslaan in cloud mislukt: ${e}`));
    }
  }

  async function handleGitInit(path: string) {
    try {
      await gitInit(path);
      showToast("Git-repo aangemaakt.");
      runScan();
    } catch (e) {
      showToast(`git init mislukt: ${e}`);
    }
  }

  async function handleLaunch(p: Project) {
    if (!tauri) {
      showToast("Launchen werkt alleen in de desktop-app.");
      return;
    }
    const path = localPath(p);
    if (!path) {
      showToast("Geen lokaal pad voor dit project op deze PC.");
      return;
    }
    const command = runCommandOf(p);
    openTerminal({ title: `dev · ${p.name}`, cwd: path, initialCommand: command });
    showToast(`Start: ${command}`);

    // Webapp? Wacht tot de dev-server luistert en open dan de browser.
    const url = devUrlOf(p);
    if (!url) return;
    const port = portFromUrl(url);
    if (!port) {
      // Geen poort te bepalen: open meteen, mogelijk net te vroeg.
      await openBrowser(url).catch((e) => showToast(`Browser openen mislukt: ${e}`));
      return;
    }
    showToast(`Wachten tot ${url} klaar is…`);
    const ready = await waitForPort(port);
    if (ready) {
      await openBrowser(url).catch((e) => showToast(`Browser openen mislukt: ${e}`));
    } else {
      showToast(`${url} reageerde niet op tijd — open handmatig.`);
    }
  }

  async function handleClaude(p: Project, instruction: string) {
    if (!tauri) {
      showToast("Claude openen werkt alleen in de desktop-app.");
      return;
    }
    const path = localPath(p);
    if (!path) {
      showToast("Geen lokaal pad voor dit project op deze PC.");
      return;
    }
    try {
      const line = await claudeShellLine(path, buildClaudePrompt(p, instruction));
      openTerminal({ title: `Claude · ${p.name}`, cwd: path, initialCommand: line });
      showToast("Claude geopend in de terminal.");
    } catch (e) {
      showToast(`Claude openen mislukt: ${e}`);
    }
  }

  async function handleDelete(p: Project, opts: DeleteOptions) {
    const path = localPath(p);
    try {
      // 1. Lokale map naar prullenbak (herstelbaar) — vóór de onomkeerbare stap.
      if (opts.trashFolder) {
        if (!tauri) throw new Error("Prullenbak werkt alleen in de desktop-app.");
        if (!path) throw new Error("Geen lokaal pad op deze PC.");
        await trashPath(path);
      }
      // 2. GitHub-repo definitief verwijderen (onomkeerbaar, dus als laatste).
      if (opts.deleteGithub) {
        await deleteGithubRepo(p.remoteUrl, settings.githubToken ?? "");
      }
      // 3. Uit het overzicht: pad negeren zodat een rescan het niet terughaalt,
      //    en het cloud-record opruimen.
      if (path) addIgnored(path);
      if (isLoggedIn()) await deleteProjectFromCloud(p.key);

      setProjects((prev) => prev.filter((x) => x.key !== p.key));
      setSelectedKey(null);
      setIgnored(loadIgnored());
      showToast(`'${p.name}' verwijderd.`);
    } catch (e) {
      showToast(`Verwijderen mislukt: ${e}`);
      throw e; // laat de dialoog open bij een fout
    }
  }

  function handleIgnore(path: string) {
    addIgnored(path);
    setIgnored((prev) => [...prev, path]);
  }

  async function handleLogin(email: string, password: string) {
    await pbLogin(email, password);
    setUserEmail(currentUser()?.email ?? null);
    showToast("Ingelogd. Synchroniseren…");
    await runScan();
  }

  function handleLogout() {
    pbLogout();
    setUserEmail(null);
    runScan();
  }

  function openProject(p: Project) {
    setSelectedKey(p.key);
  }

  // Live Claude-status: pollt de hook-statusbestanden via de backend.
  useEffect(() => {
    if (!tauri) return;
    let active = true;
    const tick = async () => {
      try {
        const rows = await claudeStatus();
        if (active) {
          setClaudeRows(Object.fromEntries(rows.map((r) => [r.path, { state: r.state, ts: r.ts }])));
        }
      } catch {
        /* negeer */
      }
    };
    tick();
    const id = window.setInterval(tick, 2500);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, [tauri]);

  // Claude-status per project-key (op lokaal pad gematcht; oude leftovers weg).
  const claudeByKey = useMemo(() => {
    const now = Date.now() / 1000;
    const m: Record<string, ClaudeState> = {};
    for (const p of projects) {
      const path = localPath(p);
      if (!path) continue;
      const row = claudeRows[path];
      if (!row || now - row.ts > 8 * 3600) continue;
      // "busy" dat >10 min niet ververst is, behandelen we als idle (mogelijk
      // afgebroken sessie of Claude wacht op input).
      const age = now - row.ts;
      if (row.state === "busy") m[p.key] = age > 600 ? "idle" : "busy";
      else if (row.state === "idle") m[p.key] = "idle";
    }
    return m;
  }, [projects, claudeRows]);

  const selected = useMemo(
    () => projects.find((p) => p.key === selectedKey) ?? null,
    [projects, selectedKey],
  );

  const visibleNoGit = useMemo(
    () => (scan?.no_git ?? []).filter((f) => !ignored.includes(f.path)),
    [scan, ignored],
  );

  const pcCount = useMemo(() => {
    const set = new Set<string>();
    projects.forEach((p) => p.states.forEach((s) => set.add(s.machine)));
    return Math.max(set.size, 1);
  }, [projects]);

  function nav(v: View) {
    setSelectedKey(null);
    setView(v);
  }

  return (
    <div className={`app${tauri ? " has-dock" : ""}${tauri && dockOpen ? " dock-open" : ""}`}>
      <Sidebar
        view={view}
        onNav={nav}
        machine={machine}
        machineLabel={settings.machineLabel}
        repoCount={projects.length}
        noGitCount={visibleNoGit.length}
        lastScan={lastScan}
        scanning={scanning}
        synced={!!userEmail}
      />

      {selected ? (
        <ProjectDetail
          key={selected.key}
          project={selected}
          claudeState={claudeByKey[selected.key] ?? null}
          hasGithubToken={!!settings.githubToken}
          onBack={() => setSelectedKey(null)}
          onSave={handleSaveMeta}
          onOpenPath={openPath}
          onLaunch={handleLaunch}
          onClaude={handleClaude}
          onDelete={handleDelete}
        />
      ) : view === "instellingen" ? (
        <SettingsView
          settings={settings}
          machine={machine}
          pbEnabled={pbEnabled}
          userEmail={userEmail}
          isTauri={tauri}
          onChange={updateSettings}
          onPickFolder={pickFolder}
          onRescan={() => runScan()}
          onLogin={handleLogin}
          onLogout={handleLogout}
        />
      ) : (
        <Dashboard
          projects={projects}
          claudeByKey={claudeByKey}
          noGit={visibleNoGit}
          machineName={machineName}
          pcCount={pcCount}
          scanning={scanning}
          theme={theme}
          hasRoots={settings.roots.length > 0}
          onToggleTheme={toggleTheme}
          onScan={() => runScan()}
          onOpen={openProject}
          onLaunch={handleLaunch}
          onGitInit={handleGitInit}
          onIgnore={handleIgnore}
          onOpenPath={openPath}
          onGoSettings={() => setView("instellingen")}
        />
      )}

      {tauri && (
        <TerminalDock
          terminals={terminals}
          activeId={activeTermId}
          open={dockOpen}
          onSelect={setActiveTermId}
          onClose={removeTerminal}
          onExit={removeTerminal}
          onNew={newPlainTerminal}
          onToggle={() => setDockOpen((o) => !o)}
        />
      )}

      {!tauri && (
        <div className="toast" style={{ left: 22, right: "auto" }}>
          Browser-preview · git-scan werkt alleen in de desktop-app
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
