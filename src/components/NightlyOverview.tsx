import { useEffect, useState } from "react";
import type { NightlyRun } from "../lib/tauri";
import { nightlyStatus, readLogFile, type NightlyStatusInfo } from "../lib/tauri";
import { groupByNight, summaryText, OUTCOME_LABEL, durationOf, timeOf } from "../lib/nightly";
import { relativeTime } from "../lib/format";

const OUTCOME_CLASS: Record<string, string> = {
  done: "o-done",
  failed: "o-failed",
  skipped: "o-skipped",
};

/** Eén regel in het overzicht; klapt de volledige output uit als die er is. */
function RunRow({ run }: { run: NightlyRun }) {
  const [log, setLog] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggleLog() {
    if (log !== null) {
      setLog(null);
      return;
    }
    if (!run.logPath) return;
    setLoading(true);
    setError(null);
    try {
      setLog(await readLogFile(run.logPath));
    } catch (e) {
      setError(`Log lezen mislukt: ${e}`);
    } finally {
      setLoading(false);
    }
  }

  const duur = durationOf(run);

  return (
    <div className="run">
      <div className="run-head">
        <span className={`badge ${OUTCOME_CLASS[run.outcome]}`}>{OUTCOME_LABEL[run.outcome]}</span>
        <span className="run-title">{run.title}</span>
        <span className="run-project">{run.projectName || "geen project"}</span>
        <span className="run-when">
          {timeOf(run.startedAt)}
          {duur && ` · ${duur}`}
        </span>
      </div>
      {run.reason && <div className="run-reason">{run.reason}</div>}
      {run.logPath && (
        <button type="button" className="mini ghost run-log-btn" onClick={toggleLog} disabled={loading}>
          {loading ? "Laden…" : log !== null ? "Verberg output" : "Toon output"}
        </button>
      )}
      {error && <div className="run-reason">{error}</div>}
      {log !== null && <pre className="run-log">{log.trimEnd() || "(geen output)"}</pre>}
    </div>
  );
}

export default function NightlyOverview({
  runs,
  isTauri,
  onMarkSeen,
}: {
  runs: NightlyRun[];
  isTauri: boolean;
  onMarkSeen: () => void;
}) {
  const [status, setStatus] = useState<NightlyStatusInfo | null>(null);

  // Openen telt als gezien: de "nieuw"-markering in de zijbalk verdwijnt.
  useEffect(() => {
    onMarkSeen();
  }, [onMarkSeen]);

  useEffect(() => {
    if (!isTauri) return;
    nightlyStatus()
      .then(setStatus)
      .catch(() => {});
  }, [isTauri]);

  const nachten = groupByNight(runs);

  return (
    <main className="main">
      <div className="top">
        <div>
          <h1>Nachtelijke runs</h1>
          <div className="sub">Wat Projectradar 's nachts voor je heeft opgepakt</div>
        </div>
      </div>

      {isTauri && (
        <div className="panel">
          <h2>Achtergrondlus</h2>
          <p className="hint" style={{ marginBottom: 0 }}>
            {status?.lastTickAt
              ? `Actief · voor het laatst ${relativeTime(status.lastTickAt)}.`
              : "Wacht op de eerste tick (binnen een minuut na opstarten)."}
            {status?.lastFireAt
              ? ` Laatste batch ${relativeTime(status.lastFireAt)} — ${status.lastFireSummary}`
              : " Nog geen batch gedraaid."}
          </p>
        </div>
      )}

      {nachten.length === 0 ? (
        <div className="empty">
          <div className="big">☾</div>
          <h2>Nog geen nachtelijke runs</h2>
          <p>
            {isTauri
              ? "Zodra er 's nachts een prompt uit PromptPad wordt opgepakt, verschijnt hier per prompt wat er gebeurde — ook als de app tussendoor herstart is."
              : "Nachtelijke runs werken alleen in de desktop-app."}
          </p>
        </div>
      ) : (
        nachten.map((nacht) => (
          <div className="panel night" key={nacht.date}>
            <div className="night-head">
              <h2>{nacht.label}</h2>
              <span className="night-sum">
                {nacht.summary.total} {nacht.summary.total === 1 ? "prompt" : "prompts"} ·{" "}
                {summaryText(nacht.summary)}
              </span>
            </div>
            <div className="run-list">
              {nacht.runs.map((run) => (
                <RunRow key={`${run.promptId}-${run.startedAt}`} run={run} />
              ))}
            </div>
          </div>
        ))
      )}
    </main>
  );
}
