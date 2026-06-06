import type { MachineInfo } from "../types";
import { relativeTime } from "../lib/format";

export type View = "overzicht" | "instellingen";

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
        <button
          className={view === "instellingen" ? "on" : ""}
          onClick={() => onNav("instellingen")}
        >
          <span className="ic">⚙</span> Instellingen
        </button>
      </nav>
      <div className="spacer" />
      <div className="pc-card">
        <div className="row">
          <span className={`dot${scanning ? " busy" : ""}`} />
          <b style={{ color: "var(--txt)" }}>Deze PC · {name}</b>
        </div>
        <div className="row" style={{ marginTop: 9 }}>
          {scanning ? "Bezig met scannen…" : `Laatste scan · ${relativeTime(lastScan)}`}
        </div>
        <div className="row">
          {repoCount} repo&apos;s · {noGitCount} zonder git
        </div>
        <div className="row" style={{ marginTop: 9, color: synced ? "var(--ahead)" : "var(--txt-faint)" }}>
          {synced ? "☁ Gesynct" : "○ Alleen lokaal"}
        </div>
      </div>
    </aside>
  );
}
