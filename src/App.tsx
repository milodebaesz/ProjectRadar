import { useEffect, useMemo, useState } from "react";
import type { Project, ProjectMeta } from "./types";
import { uid } from "./lib/format";
import Sidebar, { type View } from "./components/Sidebar";
import Dashboard from "./components/Dashboard";
import SettingsView from "./components/Settings";
import ProjectDetail from "./components/ProjectDetail";
import { localPath, runCommandOf, devUrlOf, portFromUrl, buildClaudePrompt, toggleMilestone } from "./lib/model";
import {
  isTauri,
  gitInit,
  pickFolder,
  openPath,
  claudeShellLine,
  trashPath,
  waitForPort,
  openBrowser,
  secretGet,
  secretSet,
  GITHUB_TOKEN_KEY,
} from "./lib/tauri";
import TerminalDock from "./components/TerminalDock";
import { deleteGithubRepo } from "./lib/github";
import type { DeleteOptions } from "./components/DeleteDialog";
import { saveMeta, takeLegacyGithubToken } from "./lib/storage";
import { pbEnabled, isLoggedIn, login as pbLogin, logout as pbLogout } from "./lib/pocketbase";
import { saveProjectMeta, deleteProjectFromCloud } from "./lib/sync";
import { useTheme } from "./hooks/useTheme";
import { useAuth } from "./hooks/useAuth";
import { useScan } from "./hooks/useScan";
import { useTerminals } from "./hooks/useTerminals";
import { useClaudeStatus } from "./hooks/useClaudeStatus";
import { useScheduledRuns } from "./hooks/useScheduledRuns";
import { useRemoteBridge } from "./hooks/useRemoteBridge";
import { useNightlyRuns } from "./hooks/useNightlyRuns";

export default function App() {
  const tauri = isTauri();

  const { theme, toggleTheme } = useTheme();
  const userEmail = useAuth();

  const [view, setView] = useState<View>("overzicht");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [hasGithubToken, setHasGithubToken] = useState(false);

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2800);
  }

  // GitHub-token: migreer een eventueel oud plaintext-token naar de OS-keychain
  // en bepaal of er een token beschikbaar is voor de verwijder-actie.
  useEffect(() => {
    if (!tauri) return;
    (async () => {
      const legacy = takeLegacyGithubToken();
      if (legacy) {
        try {
          await secretSet(GITHUB_TOKEN_KEY, legacy);
        } catch {
          /* negeer; token blijft dan onbeschikbaar */
        }
      }
      try {
        setHasGithubToken(!!(await secretGet(GITHUB_TOKEN_KEY)));
      } catch {
        /* negeer */
      }
    })();
  }, [tauri]);

  const {
    settings,
    machine,
    scan,
    projects,
    setProjects,
    scanning,
    lastScan,
    ignored,
    syncError,
    runScan,
    updateSettings,
    ignorePath,
  } = useScan(tauri, showToast);

  const term = useTerminals(settings.roots[0] ?? "");
  const claudeByKey = useClaudeStatus(tauri, projects, (key) => {
    const p = projects.find((x) => x.key === key);
    showToast(`${p?.name ?? "Project"}: Claude is klaar — roadmap wordt bijgewerkt…`);
    runScan();
  });

  const machineName = settings.machineLabel || machine?.hostname || "Deze PC";

  function handleSaveMeta(meta: ProjectMeta) {
    saveMeta(meta); // lokale cache
    setProjects((prev) => prev.map((p) => (p.key === meta.key ? { ...p, meta } : p)));
    if (isLoggedIn()) {
      saveProjectMeta(meta).catch((e) => showToast(`Opslaan in cloud mislukt: ${e}`));
    }
  }

  function handleToggleMilestone(p: Project, phaseId: string, msId: string, done: boolean) {
    handleSaveMeta(toggleMilestone(p.meta, phaseId, msId, done));
  }

  /**
   * Slaat de handmatige dashboardvolgorde op. Schrijft élk project weg, ook de
   * niet-verplaatste: de rangen worden hernummerd naar 0..n-1, zodat er geen
   * gaten of dubbele posities ontstaan bij een volgende sleep.
   */
  function handleReorder(keys: string[]) {
    const rankOf = new Map(keys.map((key, i) => [key, i]));
    const updated = projects.map((p) => {
      const rank = rankOf.get(p.key);
      if (rank === undefined || p.meta.rank === rank) return p;
      const meta = { ...p.meta, key: p.key, rank };
      saveMeta(meta);
      if (isLoggedIn()) {
        saveProjectMeta(meta).catch((e) => showToast(`Volgorde opslaan in cloud mislukt: ${e}`));
      }
      return { ...p, meta };
    });
    setProjects(updated);
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
    term.openTerminal({ title: `dev · ${p.name}`, cwd: path, initialCommand: command });
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

  /** Voeg een run toe aan de per-project geschiedenis (nieuwste eerst, max 100). */
  function logClaudeRun(p: Project, label: string) {
    const entry = { id: uid(), at: new Date().toISOString(), label };
    const history = [entry, ...(p.meta.history ?? [])].slice(0, 100);
    handleSaveMeta({ ...p.meta, key: p.key, history });
  }

  async function handleClaude(p: Project, instruction: string, label?: string) {
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
      term.openTerminal({ title: `Claude · ${p.name}`, cwd: path, initialCommand: line });
      showToast("Claude geopend in de terminal.");
      logClaudeRun(p, label?.trim() || instruction.trim().split("\n")[0].slice(0, 140) || "Doorwerken (geen instructie)");
    } catch (e) {
      showToast(`Claude openen mislukt: ${e}`);
    }
  }

  useScheduledRuns(tauri, projects, handleSaveMeta, showToast);
  useRemoteBridge(tauri, projects, claudeByKey, handleToggleMilestone, handleClaude);
  useNightlyRuns(tauri, projects, term.openTerminal);

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
        const token = (await secretGet(GITHUB_TOKEN_KEY)) ?? "";
        await deleteGithubRepo(p.remoteUrl, token);
      }
      // 3. Uit het overzicht: pad negeren zodat een rescan het niet terughaalt,
      //    en het cloud-record opruimen.
      if (path) ignorePath(path);
      if (isLoggedIn()) await deleteProjectFromCloud(p.key);

      setProjects((prev) => prev.filter((x) => x.key !== p.key));
      setSelectedKey(null);
      showToast(`'${p.name}' verwijderd.`);
    } catch (e) {
      showToast(`Verwijderen mislukt: ${e}`);
      throw e; // laat de dialoog open bij een fout
    }
  }

  async function handleLogin(email: string, password: string) {
    await pbLogin(email, password);
    showToast("Ingelogd. Synchroniseren…");
    await runScan();
  }

  function handleLogout() {
    pbLogout();
    runScan();
  }

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
    <div className={`app${tauri ? " has-dock" : ""}${tauri && term.dockOpen ? " dock-open" : ""}`}>
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
        syncError={syncError}
        terminals={term.terminals}
        activeTermId={term.activeTermId}
        onSelectTerminal={(id) => {
          term.setActiveTermId(id);
          term.setDockOpen(true);
        }}
      />

      {selected ? (
        <ProjectDetail
          key={selected.key}
          project={selected}
          claudeState={claudeByKey[selected.key] ?? null}
          hasGithubToken={hasGithubToken}
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
          onTokenSaved={setHasGithubToken}
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
          onOpen={(p) => setSelectedKey(p.key)}
          onLaunch={handleLaunch}
          onToggleMilestone={handleToggleMilestone}
          onReorder={handleReorder}
          onGitInit={handleGitInit}
          onIgnore={ignorePath}
          onOpenPath={openPath}
          onGoSettings={() => setView("instellingen")}
        />
      )}

      {tauri && (
        <TerminalDock
          terminals={term.terminals}
          activeId={term.activeTermId}
          open={term.dockOpen}
          onSelect={term.setActiveTermId}
          onClose={term.removeTerminal}
          onExit={term.removeTerminal}
          onNew={term.newPlainTerminal}
          onToggle={() => term.setDockOpen(!term.dockOpen)}
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
