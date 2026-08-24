import { useEffect, useRef, useState } from "react";
import type { MachineInfo, Project, ScanResult, Settings } from "../types";
import { machineInfo as fetchMachineInfo, scanRoots } from "../lib/tauri";
import {
  loadSettings,
  saveSettings,
  loadAllMeta,
  loadIgnored,
  addIgnored,
} from "../lib/storage";
import { buildProjects } from "../lib/model";
import { isLoggedIn } from "../lib/pocketbase";
import { syncScan } from "../lib/sync";

/**
 * Owns het scannen en (indien ingelogd) de cloud-sync: root-instellingen, de
 * laatste scan, het samengevoegde project-overzicht en de scan/sync-status.
 * `showToast` toont vluchtige fouten; `syncError` blijft staan tot een geslaagde
 * sync, zodat een mislukte push zichtbaar blijft in de UI.
 */
export function useScan(tauri: boolean, showToast: (msg: string) => void) {
  const [settings, setSettings] = useState<Settings>({ roots: [], machineLabel: "", rescanInterval: 0 });
  const [machine, setMachine] = useState<MachineInfo | null>(null);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [scanning, setScanning] = useState(false);
  const [lastScan, setLastScan] = useState<string | null>(null);
  const [ignored, setIgnored] = useState<string[]>([]);
  const [syncError, setSyncError] = useState<string | null>(null);

  useEffect(() => {
    const s = loadSettings();
    setSettings(s);
    setIgnored(loadIgnored());

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runScan(s: Settings = settings) {
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
          setProjects(await syncScan(repos, info, s.machineLabel));
          setSyncError(null);
        } catch (e) {
          showToast(`Cloud-sync mislukt, lokaal getoond: ${e}`);
          setSyncError(String(e));
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

  // Stabiele ref zodat de interval-timer altijd de laatste runScan aanroept.
  const runScanRef = useRef(runScan);
  useEffect(() => { runScanRef.current = runScan; });

  useEffect(() => {
    if (!settings.rescanInterval || !settings.roots.length) return;
    const ms = settings.rescanInterval * 60 * 1000;
    const id = setInterval(() => runScanRef.current(), ms);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.rescanInterval, settings.roots.length]);

  function updateSettings(next: Settings) {
    const rootsChanged = next.roots.join("|") !== settings.roots.join("|");
    setSettings(next);
    saveSettings(next);
    if (rootsChanged) runScan(next);
  }

  function ignorePath(path: string) {
    addIgnored(path);
    setIgnored((prev) => [...prev, path]);
  }

  return {
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
  };
}
