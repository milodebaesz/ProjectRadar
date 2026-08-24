import { useEffect, useState } from "react";
import type { MachineInfo, Settings as SettingsType } from "../types";
import { relativeTime } from "../lib/format";
import {
  GITHUB_TOKEN_KEY,
  secretGet,
  secretSet,
  secretDelete,
  remoteInfo,
  remoteTokenGet,
  remoteTokenRegenerate,
  type RemoteInfo,
  nightlyConfigGet,
  nightlyConfigSet,
  nightlyConfigClear,
  nightlyRunNow,
  nightlyStatus,
  type NightlyStatusInfo,
} from "../lib/tauri";

/** Keuzes voor de auto-rescan; 0 = uit. */
const RESCAN_OPTIONS = [
  { minutes: 0, label: "Uit — alleen handmatig" },
  { minutes: 5, label: "Elke 5 minuten" },
  { minutes: 15, label: "Elke 15 minuten" },
  { minutes: 30, label: "Elk half uur" },
  { minutes: 60, label: "Elk uur" },
];

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
  /** Meld de parent of er (nog) een GitHub-token in de keychain staat. */
  onTokenSaved: (hasToken: boolean) => void;
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
  onTokenSaved,
}: Props) {
  const [manualPath, setManualPath] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // GitHub-token leeft in de OS-keychain, niet in de gesynct settings.
  const [token, setToken] = useState("");
  const [tokenSaving, setTokenSaving] = useState(false);
  const [tokenMsg, setTokenMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri) return;
    secretGet(GITHUB_TOKEN_KEY)
      .then((t) => setToken(t ?? ""))
      .catch(() => {
        /* negeer */
      });
  }, [isTauri]);

  // Extern bereik (Tailscale): URL en pairing-token voor de mobiele pagina.
  const [remote, setRemote] = useState<RemoteInfo | null>(null);
  const [remoteToken, setRemoteToken] = useState("");
  const [remoteMsg, setRemoteMsg] = useState<string | null>(null);
  const [showRemoteToken, setShowRemoteToken] = useState(false);

  useEffect(() => {
    if (!isTauri) return;
    remoteInfo().then(setRemote).catch(() => {});
    remoteTokenGet().then(setRemoteToken).catch(() => {});
  }, [isTauri]);

  // Nachtelijke prompt-runner (PromptPad): Supabase-URL is zichtbaar, de
  // sleutel niet — die komt nooit terug uit de keychain naar de webview.
  const [nightlyUrl, setNightlyUrl] = useState<string | null>(null);
  const [nightlyUrlInput, setNightlyUrlInput] = useState("");
  const [nightlyKeyInput, setNightlyKeyInput] = useState("");
  const [nightlySaving, setNightlySaving] = useState(false);
  const [nightlyMsg, setNightlyMsg] = useState<string | null>(null);
  const [nightlyRunning, setNightlyRunning] = useState(false);
  const [nightlyStat, setNightlyStat] = useState<NightlyStatusInfo | null>(null);

  // Pollt de blijvende status (overleeft een gesloten terminal) zodat je ook
  // achteraf — bijv. de ochtend na een nachtrun — kunt zien of de
  // achtergrondlus actief was en wat de laatste run deed.
  useEffect(() => {
    if (!isTauri) return;
    let cancelled = false;
    function tick() {
      nightlyStatus()
        .then((s) => !cancelled && setNightlyStat(s))
        .catch(() => {});
    }
    tick();
    const id = window.setInterval(tick, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [isTauri]);

  useEffect(() => {
    if (!isTauri) return;
    nightlyConfigGet()
      .then((u) => {
        setNightlyUrl(u);
        if (u) setNightlyUrlInput(u);
      })
      .catch(() => {});
  }, [isTauri]);

  async function saveNightlyConfig() {
    const url = nightlyUrlInput.trim();
    const key = nightlyKeyInput.trim();
    if (!url || !key) {
      setNightlyMsg("Vul zowel de URL als de sleutel in.");
      return;
    }
    setNightlySaving(true);
    setNightlyMsg(null);
    try {
      await nightlyConfigSet(url, key);
      setNightlyUrl(url);
      setNightlyKeyInput("");
      setNightlyMsg("✓ Bewaard in de keychain.");
    } catch (e) {
      setNightlyMsg(`Opslaan mislukt: ${e}`);
    } finally {
      setNightlySaving(false);
    }
  }

  async function clearNightlyConfig() {
    if (!confirm("Nachtelijke prompt-runner uitschakelen? De koppeling met PromptPad wordt verwijderd.")) return;
    await nightlyConfigClear().catch(() => {});
    setNightlyUrl(null);
    setNightlyUrlInput("");
    setNightlyKeyInput("");
    setNightlyMsg("Uitgeschakeld.");
  }

  async function runNightlyNow() {
    setNightlyRunning(true);
    setNightlyMsg(null);
    try {
      await nightlyRunNow();
      setNightlyMsg("Gestart — nieuwe sessies verschijnen als tab in de terminal-dock zodra ze draaien.");
    } catch (e) {
      setNightlyMsg(`Starten mislukt: ${e}`);
    } finally {
      setNightlyRunning(false);
    }
  }

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setRemoteMsg(`${label} gekopieerd.`);
    } catch {
      setRemoteMsg(`Kopiëren mislukt — selecteer en kopieer handmatig.`);
    }
  }

  async function regenerateRemoteToken() {
    if (!confirm("Nieuw token aanmaken? Al gekoppelde telefoons moeten dan opnieuw pairen.")) return;
    const t = await remoteTokenRegenerate();
    setRemoteToken(t);
    setRemoteMsg("Nieuw token aangemaakt — oude koppelingen werken niet meer.");
  }

  async function saveToken() {
    setTokenSaving(true);
    setTokenMsg(null);
    try {
      const v = token.trim();
      if (v) await secretSet(GITHUB_TOKEN_KEY, v);
      else await secretDelete(GITHUB_TOKEN_KEY);
      onTokenSaved(!!v);
      setTokenMsg(v ? "✓ Bewaard in de keychain." : "Token verwijderd.");
    } catch (e) {
      setTokenMsg(`Opslaan mislukt: ${e}`);
    } finally {
      setTokenSaving(false);
    }
  }

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

        <div className="field" style={{ marginTop: 18, marginBottom: 0, maxWidth: 320 }}>
          <label htmlFor="rescan-interval">Automatisch opnieuw scannen</label>
          <select
            id="rescan-interval"
            value={settings.rescanInterval}
            onChange={(e) => onChange({ ...settings, rescanInterval: Number(e.target.value) })}
          >
            {RESCAN_OPTIONS.map((o) => (
              <option key={o.minutes} value={o.minutes}>
                {o.label}
              </option>
            ))}
          </select>
          <p className="hint" style={{ marginTop: 6, marginBottom: 0 }}>
            {settings.rescanInterval > 0
              ? `De git-stand blijft vanzelf bijwerken; er wordt elke ${settings.rescanInterval} minuten opnieuw gescand zolang de app open staat.`
              : "Staat uit — de git-stand werkt alleen bij als je zelf op Scannen klikt."}
          </p>
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
          of <code>Administration: read &amp; write</code> (fine-grained). Wordt
          veilig in de <strong>OS-keychain</strong> van deze PC bewaard, niet in
          gewone instellingen.
        </p>
        {isTauri ? (
          <>
            <div className="field">
              <label>Personal Access Token</label>
              <input
                type="password"
                placeholder="ghp_…"
                value={token}
                onChange={(e) => {
                  setToken(e.target.value);
                  setTokenMsg(null);
                }}
                onKeyDown={(e) => e.key === "Enter" && saveToken()}
                style={{ fontFamily: "var(--mono)" }}
              />
            </div>
            <div className="row-actions" style={{ alignItems: "center" }}>
              <button className="btn" onClick={saveToken} disabled={tokenSaving}>
                {tokenSaving ? "Bewaren…" : "Bewaren in keychain"}
              </button>
              {tokenMsg && (
                <span className="hint" style={{ margin: 0 }}>
                  {tokenMsg}
                </span>
              )}
            </div>
          </>
        ) : (
          <p className="hint" style={{ marginBottom: 0 }}>
            Token-opslag werkt alleen in de desktop-app (gebruikt de OS-keychain).
          </p>
        )}
      </div>

      <div className="panel">
        <h2>Nachtelijke prompts (PromptPad)</h2>
        {!isTauri ? (
          <p className="hint" style={{ marginBottom: 0 }}>
            Werkt alleen in de desktop-app.
          </p>
        ) : (
          <>
            <p className="hint">
              Elke nacht tussen 03:00 en 06:00 haalt Projectradar openstaande
              prompts op uit PromptPad (Supabase-tabel <code>pp_prompts</code>),
              matcht ze op projectnaam en voert ze strikt na elkaar uit via
              Claude Code — ook over projecten heen. Een prompt wordt
              pas als <em>gedaan</em> gemarkeerd als Claude zelf zonder fout
              afsloot; bij een mislukking blijft hij open voor een volgende
              poging. Draait als achtergrondproces, dus ook met een
              vergrendeld scherm — zorg wel dat de Mac niet in slaap valt
              (bijv. met <code>caffeinate</code>) en dat je Projectradar niet
              met Cmd+Q afsluit.
            </p>
            <p className="hint" style={{ fontFamily: "var(--mono)", fontSize: 12 }}>
              {nightlyStat?.lastTickAt
                ? `Achtergrondlus actief · voor het laatst ${relativeTime(nightlyStat.lastTickAt)}`
                : "Achtergrondlus: wacht op de eerste tick (binnen een minuut na opstarten)."}
              <br />
              {nightlyStat?.lastFireAt ? (
                <>
                  Laatste run: {relativeTime(nightlyStat.lastFireAt)} — {nightlyStat.lastFireSummary}
                </>
              ) : (
                "Laatste run: nog nooit gedraaid."
              )}
            </p>
            <div className="field">
              <label>Supabase-URL</label>
              <input
                type="url"
                placeholder="https://xxxx.supabase.co"
                value={nightlyUrlInput}
                onChange={(e) => setNightlyUrlInput(e.target.value)}
                style={{ fontFamily: "var(--mono)" }}
              />
            </div>
            {nightlyUrl && (
              <p className="hint" style={{ marginTop: -6 }}>
                Al actief voor <code>{nightlyUrl}</code>. De sleutel staat alleen in de
                keychain, niet hier — om iets te wijzigen vul je 'm opnieuw in.
              </p>
            )}
            <div className="field">
              <label>Publishable / anon key</label>
              <input
                type="password"
                placeholder="eyJ…"
                value={nightlyKeyInput}
                onChange={(e) => setNightlyKeyInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveNightlyConfig()}
                style={{ fontFamily: "var(--mono)" }}
              />
            </div>
            <div className="row-actions" style={{ alignItems: "center" }}>
              <button className="btn" onClick={saveNightlyConfig} disabled={nightlySaving}>
                {nightlySaving ? "Bewaren…" : "Bewaren in keychain"}
              </button>
              {nightlyUrl && (
                <>
                  <button className="btn ghost" onClick={runNightlyNow} disabled={nightlyRunning}>
                    {nightlyRunning ? "Bezig…" : "Nu uitvoeren"}
                  </button>
                  <button className="btn ghost" onClick={clearNightlyConfig}>
                    Uitschakelen
                  </button>
                </>
              )}
              {nightlyMsg && (
                <span className="hint" style={{ margin: 0 }}>
                  {nightlyMsg}
                </span>
              )}
            </div>
            {nightlyUrl && (
              <p className="hint" style={{ marginTop: 10, marginBottom: 0 }}>
                Let op: elke nieuwe prompt in PromptPad wordt automatisch als
                taak gezien — schrijf geen prompt die je niet onbeheerd wil
                laten draaien.
              </p>
            )}
          </>
        )}
      </div>

      <div className="panel">
        <h2>Extern bereik (Tailscale)</h2>
        {!isTauri ? (
          <p className="hint" style={{ marginBottom: 0 }}>
            Werkt alleen in de desktop-app.
          </p>
        ) : !remote ? (
          <p className="hint" style={{ marginBottom: 0 }}>Laden…</p>
        ) : !remote.active ? (
          <p className="hint" style={{ marginBottom: 0 }}>
            Geen Tailscale-IP gevonden op deze PC — extern bereik staat uit. Zorg dat
            Tailscale draait en start Projectradar opnieuw op.
          </p>
        ) : (
          <>
            <p className="hint">
              Open de URL hieronder in Safari op je iPhone (met Tailscale actief) en
              plak het token bij de eerste keer verbinden. Vanaf daar zie je live de
              status van je projecten en kun je mijlpalen afvinken of een sprint laten
              oppakken door Claude.
            </p>
            <div className="field">
              <label>URL</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input readOnly value={remote.url ?? ""} style={{ fontFamily: "var(--mono)" }} />
                <button className="mini" onClick={() => copy(remote.url ?? "", "URL")}>
                  Kopieer
                </button>
              </div>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Token</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  readOnly
                  type={showRemoteToken ? "text" : "password"}
                  value={remoteToken}
                  style={{ fontFamily: "var(--mono)" }}
                />
                <button className="mini" onClick={() => setShowRemoteToken((v) => !v)}>
                  {showRemoteToken ? "Verberg" : "Toon"}
                </button>
                <button className="mini" onClick={() => copy(remoteToken, "Token")}>
                  Kopieer
                </button>
              </div>
            </div>
            <div className="row-actions" style={{ alignItems: "center", marginTop: 12 }}>
              <button className="btn ghost" onClick={regenerateRemoteToken}>
                Nieuw token genereren
              </button>
              {remoteMsg && (
                <span className="hint" style={{ margin: 0 }}>
                  {remoteMsg}
                </span>
              )}
            </div>
          </>
        )}
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
