import { useState } from "react";
import type { MachineInfo, Settings as SettingsType } from "../types";

interface Props {
  settings: SettingsType;
  machine: MachineInfo | null;
  pbEnabled: boolean;
  userEmail: string | null;
  isTauri: boolean;
  onChange: (s: SettingsType) => void;
  onPickFolder: () => Promise<string | null>;
  onRescan: () => void;
  onLogin: (email: string, password: string) => Promise<void>;
  onLogout: () => void;
}

export default function Settings({
  settings,
  machine,
  pbEnabled,
  userEmail,
  isTauri,
  onChange,
  onPickFolder,
  onRescan,
  onLogin,
  onLogout,
}: Props) {
  const [manualPath, setManualPath] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function addRoot(path: string) {
    const p = path.trim();
    if (!p || settings.roots.includes(p)) return;
    onChange({ ...settings, roots: [...settings.roots, p] });
  }

  function removeRoot(path: string) {
    onChange({ ...settings, roots: settings.roots.filter((r) => r !== path) });
  }

  async function pick() {
    const p = await onPickFolder();
    if (p) addRoot(p);
  }

  async function submitLogin() {
    setLoginError(null);
    setBusy(true);
    try {
      await onLogin(email.trim(), password);
      setPassword("");
    } catch (e) {
      setLoginError("Inloggen mislukt — controleer e-mail en wachtwoord.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="main">
      <div className="top">
        <div>
          <h1>Instellingen</h1>
          <div className="sub">Root-mappen, deze PC en cloud-sync</div>
        </div>
      </div>

      <div className="panel">
        <h2>Root-mappen</h2>
        <p className="hint">
          Mappen die op deze PC automatisch worden afgezocht naar git-projecten.
        </p>
        {settings.roots.length > 0 ? (
          <div className="root-list">
            {settings.roots.map((r) => (
              <div className="root-item" key={r}>
                <span className="p">{r}</span>
                <button onClick={() => removeRoot(r)}>verwijderen</button>
              </div>
            ))}
          </div>
        ) : (
          <p className="hint">Nog geen root-mappen toegevoegd.</p>
        )}

        <div className="row-actions">
          {isTauri ? (
            <button className="btn" onClick={pick}>
              + Map kiezen
            </button>
          ) : (
            <>
              <input
                placeholder="/pad/naar/map"
                value={manualPath}
                onChange={(e) => setManualPath(e.target.value)}
                style={{ maxWidth: 320 }}
              />
              <button
                className="btn"
                onClick={() => {
                  addRoot(manualPath);
                  setManualPath("");
                }}
              >
                Toevoegen
              </button>
            </>
          )}
          <button className="btn ghost" onClick={onRescan} disabled={!settings.roots.length}>
            Nu scannen
          </button>
        </div>
      </div>

      <div className="panel">
        <h2>Deze PC</h2>
        <p className="hint">Naam waaronder deze machine in het overzicht verschijnt.</p>
        <div className="field">
          <label>Label</label>
          <input
            placeholder={machine?.hostname || "MacBook"}
            value={settings.machineLabel}
            onChange={(e) => onChange({ ...settings, machineLabel: e.target.value })}
          />
        </div>
        <p className="hint" style={{ marginBottom: 0 }}>
          Hostnaam: <code>{machine?.hostname ?? "—"}</code> · OS:{" "}
          <code>{machine?.os ?? "—"}</code>
        </p>
      </div>

      <div className="panel">
        <h2>GitHub</h2>
        <p className="hint">
          Personal Access Token om repo&apos;s vanuit Projectradar te kunnen
          verwijderen. Maak een token met de scope <code>delete_repo</code> (classic)
          of <code>Administration: read &amp; write</code> (fine-grained). Wordt alleen
          lokaal op deze PC bewaard.
        </p>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Personal Access Token</label>
          <input
            type="password"
            placeholder="ghp_…"
            value={settings.githubToken ?? ""}
            onChange={(e) => onChange({ ...settings, githubToken: e.target.value || undefined })}
            style={{ fontFamily: "var(--mono)" }}
          />
        </div>
      </div>

      <div className="panel">
        <h2>Cloud-sync (PocketBase)</h2>
        {!pbEnabled ? (
          <p className="hint" style={{ marginBottom: 0 }}>
            Niet geconfigureerd — Projectradar draait volledig lokaal op deze PC. Zet{" "}
            <code>VITE_PB_URL</code> in een <code>.env</code> (bijv. je VPS-URL) om
            centrale sync over meerdere PC&apos;s aan te zetten. Zie{" "}
            <code>pocketbase/README.md</code>.
          </p>
        ) : userEmail ? (
          <>
            <p className="hint">
              ✓ Ingelogd als <code>{userEmail}</code>. Je projectstand wordt over je
              PC&apos;s gedeeld.
            </p>
            <button className="btn ghost" onClick={onLogout}>
              Uitloggen
            </button>
          </>
        ) : (
          <>
            <p className="hint">
              Log in met je account om je projecten over meerdere PC&apos;s te
              synchroniseren. Tot dan toont deze PC alleen lokale data.
            </p>
            <div className="field">
              <label>E-mail</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitLogin()}
              />
            </div>
            <div className="field">
              <label>Wachtwoord</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitLogin()}
              />
            </div>
            {loginError && (
              <p className="hint" style={{ color: "var(--behind)" }}>
                {loginError}
              </p>
            )}
            <button className="btn" onClick={submitLogin} disabled={busy || !email || !password}>
              {busy ? "Inloggen…" : "Inloggen"}
            </button>
          </>
        )}
      </div>
    </main>
  );
}
