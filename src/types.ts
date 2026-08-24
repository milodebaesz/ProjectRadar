// ── Wat de Rust-backend teruggeeft ──

export interface RepoInfo {
  path: string;
  name: string;
  branch: string | null;
  detached: boolean;
  last_commit_hash: string | null;
  last_commit_message: string | null;
  last_commit_date: string | null; // ISO-8601
  total_commits: number;
  /** Aantal commits in de afgelopen 7 dagen. */
  weekly_commits: number;
  has_uncommitted: boolean;
  remote_url: string | null;
  has_upstream: boolean;
  ahead: number;
  behind: number;
  detected_stack: string[];
  /** Auto-gedetecteerd start-commando op basis van package.json scripts. */
  default_run_command: string | null;
  /** Auto-gedetecteerde dev-URL (poort + framework); null als geen webapp. */
  default_dev_url: string | null;
  /** Inhoud van een `.projectradar.json` in de repo-root, indien aanwezig. */
  radar_meta: Partial<ProjectMeta> | null;
}

export interface NoGitFolder {
  path: string;
  name: string;
}

export interface ScanResult {
  repos: RepoInfo[];
  no_git: NoGitFolder[];
}

export interface MachineInfo {
  hostname: string;
  os: string;
}

// ── Handmatige, persistente projectvelden ──

export type Status = "idee" | "actief" | "onhold" | "afgerond";

/** Live status van een Claude Code-sessie voor een project. */
export type ClaudeState = "busy" | "idle";

export const STATUS_LABEL: Record<Status, string> = {
  idee: "Idee",
  actief: "Actief",
  onhold: "On hold",
  afgerond: "Afgerond",
};

export interface Milestone {
  id: string;
  text: string;
  done: boolean;
}

export interface Phase {
  id: string;
  name: string;
  target?: string; // optionele streefdatum (vrije tekst / ISO)
  /** Sprint/fase tijdelijk gepauzeerd — wordt overgeslagen door "Pak de draad op". */
  onHold?: boolean;
  /** ISO-datetime: geplande automatische start van deze sprint via Claude. */
  scheduledAt?: string;
  milestones: Milestone[];
}

/** Eén Claude-run die via ProjectRadar is gestart (log-item). */
export interface HistoryEntry {
  id: string;
  at: string; // ISO-datetime
  /** Korte omschrijving: sprintnaam, mijlpaal, of het begin van de vrije instructie. */
  label: string;
}

export interface ProjectMeta {
  key: string; // genormaliseerde projectnaam
  description?: string;
  status?: Status;
  stack?: string[]; // overschrijft/vult de gedetecteerde stack aan
  links?: { repo?: string; deploy?: string };
  roadmap?: Phase[];
  /** Commando om de dev-server te starten (overschrijft de auto-detectie). */
  runCommand?: string;
  /** URL die na het starten in de browser opent (leeg = geen browser). */
  devUrl?: string;
  /** Project-specifieke instructies voor Claude bij het genereren/checken van de roadmap. */
  claudeInstructions?: string;
  /** Project-specifieke instructies voor Claude bij het checken van design/UI/UX. */
  designInstructions?: string;
  /** Log van Claude-runs via ProjectRadar, nieuwste eerst. */
  history?: HistoryEntry[];
  /**
   * Handmatige positie in het dashboard (0 = bovenaan), gezet door te slepen
   * in de sorteerstand "Eigen volgorde". Leeg voor projecten die nooit
   * gesleept zijn; die zakken naar onderen.
   */
  rank?: number;
}

// ── Per-PC git-stand (lokale scan, aangevuld vanuit PocketBase) ──

export interface PcState {
  machine: string; // hostname/label
  /** Lokaal pad naar de repo op deze machine (alleen bekend voor deze PC). */
  path: string | null;
  branch: string | null;
  detached: boolean;
  lastCommitDate: string | null;
  lastCommitHash: string | null;
  totalCommits: number;
  /** Aantal commits in de afgelopen 7 dagen. */
  weeklyCommits: number;
  hasUncommitted: boolean;
  ahead: number;
  behind: number;
  isThisPc: boolean;
}

// Samengevoegd beeld dat de UI toont.
export interface Project {
  key: string;
  name: string;
  meta: ProjectMeta;
  states: PcState[]; // één of meer PC's
  detectedStack: string[];
  remoteUrl: string | null;
  /** Auto-gedetecteerd start-commando op deze PC (bijv. "npm run dev"). */
  defaultRunCommand?: string | null;
  /** Auto-gedetecteerde dev-URL op deze PC (bijv. "http://localhost:5173"). */
  defaultDevUrl?: string | null;
}

export interface Settings {
  roots: string[];
  machineLabel: string;
  /** Auto-rescan interval in minuten; 0 = uitgeschakeld. */
  rescanInterval: number;
}
