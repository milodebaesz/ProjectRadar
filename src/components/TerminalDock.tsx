import { useEffect, useRef } from "react";
import { Channel } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { ptySpawn, ptyWrite, ptyResize, ptyKill } from "../lib/tauri";

export interface TermSpec {
  id: string; // frontend-id (uuid)
  title: string;
  cwd: string;
  initialCommand?: string;
}

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

    requestAnimationFrame(() => {
      try {
        fit.fit();
      } catch {
        /* leeg */
      }
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

  // Bij actief worden: opnieuw passen op de (nu zichtbare) container.
  useEffect(() => {
    if (!active) return;
    requestAnimationFrame(() => {
      try {
        fitRef.current?.fit();
        if (ptyId.current != null) {
          // cols/rows zitten in de fit; resize wordt door ResizeObserver ook getriggerd
        }
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
            <div
              key={t.id}
              className={`term-tab${t.id === activeId ? " on" : ""}`}
              onClick={() => onSelect(t.id)}
              title={t.cwd}
            >
              <span className="dot" />
              <span className="lbl">{t.title}</span>
              <button
                className="x"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(t.id);
                }}
                title="Tab sluiten"
              >
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
