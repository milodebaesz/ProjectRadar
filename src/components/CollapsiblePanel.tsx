import { useState, type ReactNode } from "react";
import { loadPanelCollapsed, savePanelCollapsed } from "../lib/storage";

interface Props {
  /** Uniek per project + paneel, bijv. `${project.key}:roadmap`. Bepaalt de onthouden in-/uitklapstand. */
  id: string;
  title: ReactNode;
  /** Compacte samenvatting, alleen zichtbaar als het paneel is ingeklapt. */
  summary?: ReactNode;
  /** Acties (knoppen) rechts in de kop, alleen zichtbaar als het paneel is uitgeklapt. */
  actions?: ReactNode;
  defaultCollapsed?: boolean;
  className?: string;
  children: ReactNode;
}

export default function CollapsiblePanel({
  id,
  title,
  summary,
  actions,
  defaultCollapsed,
  className,
  children,
}: Props) {
  const [collapsed, setCollapsed] = useState(() => loadPanelCollapsed(id, !!defaultCollapsed));

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    savePanelCollapsed(id, next);
  }

  return (
    <div className={`panel${className ? ` ${className}` : ""}${collapsed ? " collapsed" : ""}`}>
      <div className="panel-head">
        <button type="button" className="panel-toggle" onClick={toggle} title={collapsed ? "Uitklappen" : "Inklappen"}>
          <span className="chev">{collapsed ? "▸" : "▾"}</span>
          <h2>{title}</h2>
        </button>
        <div className="panel-head-right">
          {collapsed && summary && <span className="panel-summary">{summary}</span>}
          {!collapsed && actions}
        </div>
      </div>
      {!collapsed && children}
    </div>
  );
}
