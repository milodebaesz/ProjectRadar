import type { MachineInfo } from "../types";
import { relativeTime } from "../lib/format";
import type { TermSpec } from "./TerminalDock";

export type View = "overzicht" | "nacht" | "instellingen";

interface Props {
  view: View;
  onNav: (v: View) => void;
  machine: MachineInfo | null;
  machineLabel: string;
  repoCount: number;
  noGitCount: number;
  lastScan: string | null;
  scanning: boolean;
  synced: boolean;
  /** Laatste cloud-sync-fout; blijft staan tot een geslaagde sync (null). */
  syncError: string | null;
  /** Aantal nachtelijke runs dat je nog niet hebt bekeken. */
  nightlyUnseen?: number;
  /** Actieve terminal-processen (voor de "actieve processen"-lijst). */
  terminals?: TermSpec[];
  activeTermId?: string | null;
  onSelectTerminal?: (id: string) => void;
}

export default function Sidebar({
  view,
  onNav,
  machine,
  machineLabel,
  repoCount,
  noGitCount,
  lastScan,
  scanning,
  synced,
  syncError,
  nightlyUnseen = 0,
  terminals = [],
  activeTermId = null,
  onSelectTerminal,
}: Props) {
  const name = machineLabel || machine?.hostname || "Deze PC";
  return (
    <aside className="side">
      <div className="brand">
        <div className="logo" />
        <b>Projectradar</b>
      </div>
      <nav className="nav">
        <button
          className={view === "overzicht" ? "on" : ""}
          onClick={() => onNav("overzicht")}
        >
          <span className="ic">▦</span> Overzicht
        </button>
        <button className={view === "nacht" ? "on" : ""} onClick={() => onNav("nacht")}>
          <span className="ic">☾</span> Nachtelijke runs
          {nightlyUnseen > 0 && (
            <span className="nav-badge" title={`${nightlyUnseen} nieuw sinds je laatste bezoek`}>
              {nightlyUnseen}
            </span>
          )}
        </button>
        <button
          className={view === "instellingen" ? "on" : ""}
          onClick={() => onNav("instellingen")}
        >
          <span className="ic">⚙</span> Instellingen
        </button>
      </nav>
      {terminals.length > 0 && (
        <div className="term-list">
          <div className="term-list-title">Actieve processen</div>
          {terminals.map((t) => (
            <button
              key={t.id}
              className={`term-list-item${t.id === activeTermId ? " on" : ""}`}
              onClick={() => onSelectTerminal?.(t.id)}
              title={t.cwd}
            >
              <span className="dot" />
              <span className="lbl">{t.title}</span>
            </button>
          ))}
        </div>
      )}
      <div className="spacer" />
      <div className="pc-card">
        <div className="row">
          <span className={`dot${scanning ? " busy" : ""}`} />
          <b>Deze PC · {name}</b>
        </div>
        <div className="row" style={{ marginTop: 9 }}>
          {scanning ? "Bezig met scannen…" : `Laatste scan · ${relativeTime(lastScan)}`}
        </div>
        <div className="row">
          {repoCount} repo&apos;s · {noGitCount} zonder git
        </div>
        <div className={`row ${synced ? "ok" : "muted"}`} style={{ marginTop: 9 }}>
          {synced ? "☁ Gesynct" : "○ Alleen lokaal"}
        </div>
        {syncError && (
          <div className="row sync-err" title={syncError} style={{ marginTop: 6 }}>
            ⚠ Sync mislukt
          </div>
        )}
      </div>
    </aside>
  );
}
