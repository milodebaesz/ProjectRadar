# Analyse: verbeterpunten ProjectRadar

*Opgesteld op 2026-06-13 op basis van de codebase op dat moment (Rust-backend,
React-frontend, sync-laag, styling, config).*

Algemene indruk: voor een "MVP 1/6"-project is de codebase verrassend volwassen
— bijna de hele roadmap is al gebouwd (git-scan, dashboard, PocketBase-sync,
handmatige velden, `.projectradar.json`, no-git detectie, filter/sort/zoek,
PC-divergentie, roadmap-UI), plus extra's die niet in de PRD staan (ingebouwde
PTY-terminal, Claude Code-integratie, GitHub-repo verwijderen).

## 1. Roadmap/documentatie loopt fors achter op de code

`.projectradar.json` (nieuw, untracked) markeert bijna alles als `done: false`,
terwijl het in de praktijk al werkt. Dat is meer dan een trivialiteit: het
`.projectradar.json`-mechanisme wordt straks gebruikt om de roadmap-UI te
voeden, en als de bron al bij oplevering verkeerd is, devalueert dat het hele
idee.

**Actie:** laat Claude (via `prompts/enrich-project.md`) een eerlijke versie
genereren op basis van de huidige code, en update ook `PRD.md`/README zodat ze
weer kloppen.

## 2. `mergeMeta`-precedence is een footgun (model.ts:9-20 vs sync.ts upsertProject)

- In `model.ts` **wint `.projectradar.json` altijd** over je lokale cache voor
  elk ingevuld veld. Edit je in de UI de status/omschrijving van een project
  dat ook een `.projectradar.json` heeft met die velden gevuld, dan
  overschrijft de **volgende scan** je handmatige wijziging weer.
- In `sync.ts` geldt een **andere regel**: het bestand vult alleen aan als het
  cloud-veld nog leeg is.

Twee verschillende merge-strategieën voor hetzelfde probleem, die uit elkaar
kunnen lopen tussen lokaal en cloud-overzicht.

**Voorstel:** één regel kiezen — `.projectradar.json` is een **seed bij eerste
keer zien** (geen cache/cloud-record), maar overschrijft nooit een al
bestaande handmatige waarde.

## 3. App.tsx doet te veel (450 regels)

Theme, navigatie, terminal-management, scan+sync, Claude-status polling,
login/logout, delete-flow — alles in één component. Geen functionele bug, maar
de plek waar toekomstige features (multi-PC, delen) het snelst onoverzichtelijk
worden.

**Voorstel:** opsplitsen in custom hooks: `useScan`, `useTerminals`,
`useClaudeStatus`, `useCloudSync`.

## 4. Security — drie dingen om aan te scherpen

- **`"csp": null`** in `tauri.conf.json` schakelt CSP volledig uit. Bij een app
  die een ingebouwde PTY/shell heeft, is een CSP-laag een goedkope extra
  verdediging — zelfs als React XSS al grotendeels voorkomt.
- **GitHub PAT (`delete_repo`-scope) staat in plaintext in localStorage**
  (Settings.tsx). Met devtools/CSP-null is dat makkelijk uitleesbaar.
  Overweeg Tauri's stronghold/keyring-plugin voor secrets.
- **`claude --dangerously-skip-permissions`** (git.rs:523) — bewuste keuze voor
  workflow-gemak, prima voor een soloproject, maar relevant zodra "project
  delen met anderen" (roadmap) ooit echt komt: dan kan iemand anders via de UI
  code laten uitvoeren zonder bevestiging.

## 5. Scan-performance schaalt niet lekker

`read_repo` (git.rs) doet ~6 sequentiële `git`-subprocesses per repo
(rev-parse, log, 2x rev-list, status, remote). Bij tientallen projecten over
meerdere root-mappen (MAX_DEPTH=3) wordt een scan merkbaar traag, en
`scan_roots` is volledig synchroon.

**Voorstel:** repo's parallel verwerken (bv. met `std::thread`/`rayon`).

## 6. Geen tests/lint

`package.json` heeft alleen `tsc && vite build`. Functies als `mergeMeta`,
`compareStates`, `runCommandOf`, `detect_stack`/`port_from_flags` in Rust zijn
pure functies met duidelijke edge cases (detached HEAD, geen remote/upstream —
expliciet genoemd als risico in de PRD) en zouden goedkoop te unit-testen zijn.

## 7. Design/UX, kleinere punten

- **ProjectCard toont alleen de "primary" (lokale) PC-status** in de
  meta-regel (branch/schoon/laatste activiteit). De per-PC-badges tonen wel
  ahead/behind, maar niet "schoon vs. niet-gecommit" per machine. Voor het
  PRD-doel ("in één oogopslag zien wie voorloopt én wie nog wijzigingen heeft
  staan") zou dat per PC getoond moeten worden, niet alleen voor "deze PC".
- Filter-chips en de sorteer-toggle zijn `<span>`s met onClick — geen
  `<button>`, dus niet keyboard-toegankelijk. De PRD benoemt expliciet
  toegankelijkheid; dit is een snelle fix.
- Sync-fouten verschijnen alleen als toast (2.8s) — bij een mislukte
  cloud-push zou dat persistenter getoond mogen worden (bv. in de pc-card in
  de sidebar, naast "☁ Gesynct / ○ Alleen lokaal").
- Klein nit: `format.ts:27` — `${yr === 1 ? "jaar" : "jaar"}` is een dode
  ternary (beide takken identiek).

## Prioritering

1. Roadmap/`.projectradar.json` weer laten kloppen met de code (snel, en
   voorkomt verwarring later).
2. De merge-precedence-bug fixen (#2) — dit is de enige met een reëel "ik
   verlies mijn data weer"-risico voor de gebruiker.
3. CSP + GitHub-token opslag (#4) — klein werk, groot verschil voor een app die
   straks misschien gedeeld wordt.
4. App.tsx opsplitsen — pas urgent zodra er weer features toegevoegd worden.
