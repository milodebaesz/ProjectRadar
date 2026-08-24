import { useState } from "react";
import { useEscapeKey } from "../hooks/useEscapeKey";

interface Props {
  value: string;
  onCancel: () => void;
  onSave: (value: string) => void;
  title?: string;
  hint?: string;
  placeholder?: string;
}

export default function ClaudeInstructionsModal({
  value,
  onCancel,
  onSave,
  title = "Instructies voor Claude",
  hint = "Project-specifieke instructies die worden meegestuurd als Claude de roadmap genereert of checkt — bijvoorbeeld over scope, stijl, of wat hij juist niet moet doen. Wordt opgeslagen in .projectradar.json.",
  placeholder = "Bijv. 'Focus op de iOS-app, niet op de backend' of 'Schrijf mijlpalen in het Engels'…",
}: Props) {
  const [text, setText] = useState(value);
  useEscapeKey(onCancel);

  return (
    <div className="modal-overlay" onClick={onCancel} role="presentation">
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        <p className="hint">{hint}</p>
        <div className="field" style={{ marginBottom: 0 }}>
          <textarea
            autoFocus
            rows={10}
            placeholder={placeholder}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        <div className="modal-actions">
          <button className="btn ghost" onClick={onCancel}>
            Annuleren
          </button>
          <button className="btn" onClick={() => onSave(text.trim())}>
            Opslaan
          </button>
        </div>
      </div>
    </div>
  );
}
