import { useEffect, useRef } from "react";
import { Channel } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { ptySpawn, ptyWrite, ptyResize, ptyKill, nightlyRead } from "../lib/tauri";

export interface TermSpec {
  id: string; // frontend-id (uuid)
  title: string;
  cwd: string;
  initialCommand?: string;
  /**
   * Rust-sessie-id van een nachtelijke (PromptPad) run i.p.v. een interactieve
   * PTY. Als dit gezet is, negeert de tab `cwd`/`initialCommand` en toont hij
   * in plaats daarvan een alleen-lezen weergave: gepold via `nightlyRead`
   * i.p.v. live gestreamd via `ptySpawn`, omdat de sessie al liep vóór er een
   * webview was om 'm aan te bieden (zie nightly.rs).
   */
  managedId?: number;
}

// Moet in sync blijven met MANAGED_COLS/MANAGED_ROWS in src-tauri/src/pty.rs.
// MANAGED_COLS is bindend: de managed-viewer fit bewust niet op de breedte en
// stuurt geen resize terug naar de PTY, want die sessie draait al en er is
// niemand om het aan door te geven — wijkt de breedte af, dan landen
// regelafbrekingen en cursorkolommen verkeerd. MANAGED_ROWS is alleen de
// startwaarde; de hoogte fit wél mee, zie de toelichting in de managed-tak.
const MANAGED_COLS = 100;
const MANAGED_ROWS = 32;

const TERM_THEME = {
  background: "#0a1424",
  foreground: "#e8eef9",
  cursor: "#2dd4bf",
  selectionBackground: "#1f3357",
  black: "#0f1d33",
  brightBlack: "#5d739a",
  red: "#fb7185",
  green: "#34d399",
  yellow: "#fbbf24",
  blue: "#38bdf8",
  magenta: "#a78bfa",
  cyan: "#2dd4bf",
  white: "#e8eef9",
};

/** Eén terminal-tab: beheert een xterm-instantie + bijbehorende PTY-sessie. */
function TerminalView({ spec, active, onExit }: { spec: TermSpec; active: boolean; onExit: (id: string) => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const ptyId = useRef<number | null>(null);
  /** Opnieuw passen op het paneel. Verschilt per tab-soort: een gewone tab
   *  fit op beide assen, een managed tab alleen op de hoogte (zie hieronder). */
  const refitRef = useRef<() => void>(() => {});

  useEffect(() => {
    const host = hostRef.current!;
    const term = new Terminal({
      fontFamily: '"SF Mono", "JetBrains Mono", Menlo, monospace',
      fontSize: 12.5,
      cursorBlink: true,
      theme: TERM_THEME,
    });
    const fit = new FitAddon();
    fitRef.current = fit;
    term.loadAddon(fit);
    term.open(host);

    let disposed = false;
    let unlisten: (() => void) | null = null;

    // Nachtelijke (managed) sessie: geen ptySpawn/Channel, alleen pollen. Geen
    // term.onData-koppeling, dus toetsaanslagen gaan nergens heen — bewust
    // read-only, dit is een venster op een run die al liep, geen console erop.
    if (spec.managedId != null) {
      const id = spec.managedId;
      // De bréédte blijft vast op MANAGED_COLS: daar rekent de al draaiende
      // sessie mee voor regelafbreking en cursorkolommen, en er is niemand om
      // een live-resize aan door te geven (zie pty.rs).
      //
      // De hóógte moet juist wél meebewegen. Stond die vast op MANAGED_ROWS,
      // dan werd het terminal-element ~544px hoog in een dock van ~280px;
      // de buitenste .term-host nam dan het verticaal scrollen over en xterm
      // hield zijn eigen viewport op volle hoogte — waardoor de scrollback
      // onbereikbaar was en je in een nachtelijke run niet kon terugkijken,
      // terwijl dat in een gewone (fittende) tab wel gewoon werkt. Rijen
      // mogen afwijken van de PTY: wat er bovenaan uit beeld loopt bewaart
      // xterm in de scrollback in plaats van het weg te gooien.
      const fitRows = () => {
        if (!host.clientHeight) return; // inactieve tab heeft geen zinnige maat
        const rows = fit.proposeDimensions()?.rows;
        if (rows && rows !== term.rows) term.resize(MANAGED_COLS, rows);
      };
      term.resize(MANAGED_COLS, MANAGED_ROWS);
      fitRows();
      refitRef.current = fitRows;
      const managedRo = new ResizeObserver(fitRows);
      managedRo.observe(host);
      term.write("\x1b[2m— nachtelijke run, alleen-lezen —\x1b[0m\r\n");
      let offset = 0;
      let timer: ReturnType<typeof setTimeout> | null = null;
      async function poll() {
        if (disposed) return;
        try {
          const { chunk, nextOffset, status } = await nightlyRead(id, offset);
          if (chunk) term.write(chunk);
          offset = nextOffset;
          if (status !== "running") {
            term.write(`\r\n\x1b[2m— sessie ${status === "done" ? "afgerond" : "mislukt"} —\x1b[0m\r\n`);
            return; // stopt de poll-lus; de tab blijft staan zodat je kunt terugkijken
          }
        } catch {
          /* sessie (nog) niet gevonden of tijdelijk onbereikbaar; volgende tick opnieuw */
        }
        if (!disposed) timer = setTimeout(poll, 1500);
      }
      poll();
      return () => {
        disposed = true;
        managedRo.disconnect();
        if (timer) clearTimeout(timer);
        term.dispose();
      };
    }

    refitRef.current = () => {
      try {
        fit.fit();
      } catch {
        /* leeg */
      }
    };

    requestAnimationFrame(() => {
      refitRef.current();
      const onData = new Channel<number[]>();
      onData.onmessage = (bytes) => term.write(new Uint8Array(bytes));

      ptySpawn(onData, spec.cwd, term.cols, term.rows)
        .then((id) => {
          if (disposed) {
            ptyKill(id);
            return;
          }
          ptyId.current = id;
          term.onData((d) => ptyWrite(id, d));
          if (spec.initialCommand) ptyWrite(id, spec.initialCommand + "\n");
        })
        .catch(() => term.write("\r\n\x1b[31mTerminal kon niet starten.\x1b[0m\r\n"));

      listen<number>("pty-exit", (e) => {
        if (e.payload === ptyId.current) onExit(spec.id);
      }).then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      });
    });

    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        if (ptyId.current != null) ptyResize(ptyId.current, term.cols, term.rows);
      } catch {
        /* leeg */
      }
    });
    ro.observe(host);

    return () => {
      disposed = true;
      ro.disconnect();
      if (unlisten) unlisten();
      if (ptyId.current != null) ptyKill(ptyId.current);
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Bij actief worden: opnieuw passen op de (nu zichtbare) container. Een
  // verborgen tab heeft hoogte 0, dus de maat die hij ondertussen kreeg klopt
  // niet meer. Geldt ook voor managed tabs — die passen alleen hun hoogte aan,
  // wat refitRef per tab-soort afhandelt.
  useEffect(() => {
    if (!active) return;
    requestAnimationFrame(() => {
      try {
        refitRef.current();
      } catch {
        /* leeg */
      }
    });
  }, [active]);

  return <div ref={hostRef} className="term-host" style={{ display: active ? "block" : "none" }} />;
}

interface Props {
  terminals: TermSpec[];
  activeId: string | null;
  open: boolean;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onExit: (id: string) => void;
  onNew: () => void;
  onToggle: () => void;
}

export default function TerminalDock({
  terminals,
  activeId,
  open,
  onSelect,
  onClose,
  onExit,
  onNew,
  onToggle,
}: Props) {
  return (
    <div className={`term-dock${open ? " open" : ""}`}>
      <div className="term-bar">
        <div className="term-tabs">
          {terminals.map((t) => (
            // Tab en sluitknop staan naast elkaar in plaats van genest: een
            // knop in een knop is ongeldig, en als <div onClick> was de tab
            // zelf niet met het toetsenbord te bereiken.
            <div key={t.id} className={`term-tab${t.id === activeId ? " on" : ""}`}>
              <button type="button" className="term-tab-open" onClick={() => onSelect(t.id)} title={t.cwd}>
                <span className="dot" />
                <span className="lbl">{t.title}</span>
              </button>
              <button type="button" className="x" onClick={() => onClose(t.id)} title="Tab sluiten">
                ✕
              </button>
            </div>
          ))}
          <button className="term-new" onClick={onNew} title="Nieuwe terminal">
            +
          </button>
        </div>
        <button className="term-toggle" onClick={onToggle} title={open ? "Inklappen" : "Uitklappen"}>
          {open ? "▾" : "▴"} Terminal
        </button>
      </div>
      {/* Body blijft gemount (ook ingeklapt) zodat de sessies blijven leven. */}
      <div className="term-body">
        {terminals.length === 0 ? (
          <div className="term-empty">Geen terminals. Klik op + of start een project.</div>
        ) : (
          terminals.map((t) => (
            <TerminalView key={t.id} spec={t} active={open && t.id === activeId} onExit={onExit} />
          ))
        )}
      </div>
    </div>
  );
}
