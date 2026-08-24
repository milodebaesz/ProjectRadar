import { useState } from "react";
import { useEscapeKey } from "../hooks/useEscapeKey";
import type { Project } from "../types";

export interface DeleteOptions {
  trashFolder: boolean;
  deleteGithub: boolean;
}

interface Props {
  project: Project;
  /** Lokaal pad op deze PC, of null als het project hier niet staat. */
  localPath: string | null;
  /** Heeft het project een GitHub-remote? */
  isGithub: boolean;
  /** Is er een GitHub-token ingesteld? */
  hasToken: boolean;
  onCancel: () => void;
  onConfirm: (opts: DeleteOptions) => Promise<void>;
}

export default function DeleteDialog({
  project,
  localPath,
  isGithub,
  hasToken,
  onCancel,
  onConfirm,
}: Props) {
  const [trashFolder, setTrashFolder] = useState(false);
  const [deleteGithub, setDeleteGithub] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  // Escape sluit de dialoog, maar niet terwijl het verwijderen al loopt —
  // dan is er niets meer af te breken en zou het alleen het beeld weghalen.
  useEscapeKey(() => {
    if (!busy) onCancel();
  });

  // Map of GitHub aanvinken is onomkeerbaar → naam exact overtypen verplicht.
  const destructive = trashFolder || deleteGithub;
  const nameOk = typed.trim() === project.name;
  const canConfirm = !busy && (!destructive || nameOk);

  async function confirm() {
    if (!canConfirm) return;
    setBusy(true);
    try {
      await onConfirm({ trashFolder, deleteGithub });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onCancel} role="presentation">
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2>Project verwijderen</h2>
        <p className="hint">
          <strong>{project.name}</strong> wordt uit het radar-overzicht gehaald
          {project.states.length > 1 ? " (op alle PC's)" : ""}. Kies hieronder of er
          méér moet gebeuren.
        </p>

        <label className={`del-opt${!localPath ? " disabled" : ""}`}>
          <input
            type="checkbox"
            checked={trashFolder}
            disabled={!localPath}
            onChange={(e) => setTrashFolder(e.target.checked)}
          />
          <span>
            <span className="t">Lokale map naar prullenbak</span>
            <span className="d">
              {localPath
                ? `Herstelbaar via Finder · ${localPath}`
                : "Dit project staat niet op deze PC."}
            </span>
          </span>
        </label>

        {isGithub && (
          <label className={`del-opt${!hasToken ? " disabled" : ""}`}>
            <input
              type="checkbox"
              checked={deleteGithub}
              disabled={!hasToken}
              onChange={(e) => setDeleteGithub(e.target.checked)}
            />
            <span>
              <span className="t">GitHub-repo definitief verwijderen</span>
              <span className="d">
                {hasToken
                  ? "Onomkeerbaar — verwijdert de repo op GitHub."
                  : "Stel eerst een GitHub-token in bij Instellingen."}
              </span>
            </span>
          </label>
        )}

        {destructive && (
          <div className="field" style={{ marginTop: 14 }}>
            <label>
              Typ ter bevestiging de projectnaam <code>{project.name}</code> over:
            </label>
            <input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={project.name}
            />
          </div>
        )}

        <div className="modal-actions">
          <button className="btn ghost" onClick={onCancel} disabled={busy}>
            Annuleren
          </button>
          <button className="btn danger" onClick={confirm} disabled={!canConfirm}>
            {busy ? "Verwijderen…" : "Verwijderen"}
          </button>
        </div>
      </div>
    </div>
  );
}
