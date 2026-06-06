import type { ClaudeState } from "../types";

/** Live-indicator van een Claude-sessie: pulserend bij 'bezig', dim bij 'idle'. */
export default function ClaudeBadge({ state }: { state: ClaudeState | null }) {
  if (!state) return null;
  const label = state === "busy" ? "Claude bezig" : "Claude open";
  return (
    <span className={`claude-ind ${state}`} title={label}>
      <span className="dot" />
      {label}
    </span>
  );
}
