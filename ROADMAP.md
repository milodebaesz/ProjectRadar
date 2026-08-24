# Projectradar — Roadmap

Desktop-app (Tauri 2 + React + PocketBase) die lokale git-projecten scant en
centraal samenbrengt, inclusief roadmap-editor en Claude Code-integratie.

## Status

| Sprint | Thema | Status |
|---|---|---|
| 1 | Fundament: Tauri + PocketBase + PC-koppeling | ✅ Klaar |
| 2 | Lokale git-scan (Rust) | ✅ Klaar |
| 3 | Cloud-sync + dashboard | ✅ Klaar |
| 4 | Projectverrijking + Claude + terminal | ✅ Klaar |
| 5 | Dagelijks gebruik & UX-polish | 🔜 Volgende |
| 6 | Ambient & notificaties | 🔜 Deels |
| 7 | Context & workflow | — |
| 8 | Git gezondheid | — |
| 9 | ROADMAP.md koppeling | — |
| 10 | Distributie & app-signing | — |

---

## Sprint 1 — Fundament ✅

**Klaar:**
- Tauri 2 + React 19 + TypeScript + Vite projectopzet
- PocketBase-schema: collecties `projects`, `project_states`, `machines`
- Auth: e-mail + wachtwoord via PocketBase
- PC-koppeling: hostname → `machines`-record; label instelbaar in Instellingen
- Lokale storage (localStorage) als offline-cache voor meta en instellingen
- OS-keychain integratie (Rust `secrets.rs`) voor GitHub-token

---

## Sprint 2 — Lokale git-scan ✅

**Klaar:**
- Root-mappen instellen via map-picker of handmatig pad
- Rust (`git.rs`): branch, laatste commit (hash + bericht + datum), totaal commits,
  uncommitted changes, ahead/behind t.o.v. remote, remote URL
- Auto-detectie stack aan marker-bestanden (`package.json`, `Cargo.toml`, …)
- Auto-detectie run-commando (`npm run dev`, `cargo run`, …) en dev-URL (poort)
- Niet-git-mappen apart gesorteerd; "negeren" en `git init`-actie
- `.projectradar.json` in repo-root seeden: beschrijving, status, roadmap, stack,
  run-commando, dev-URL (vult alleen lege velden, overschrijft nooit handmatig)

---

## Sprint 3 — Cloud-sync + dashboard ✅

**Klaar:**
- Push lokale scan naar PocketBase (`sync.ts`: upsert machine, project, state)
- Pull gecombineerd overzicht van alle PC's
- Multi-PC vergelijking (`compareStates`): gelijke commit-hash = in sync;
  anders toont de UI welke machine voorloopt (op datum)
- Dashboard: projectkaarten met naam, status-badge, stack, laatste activiteit,
  roadmap-voortgangsbalk, PC-badges
- Filter op status (alle / actief / idee / on hold / afgerond)
- Sorteren op naam of laatste activiteit
- Zoeken op naam, stack of branch
- Skeleton loading-states bij eerste scan

---

## Sprint 4 — Projectverrijking + Claude + terminal ✅

**Klaar:**
- Projectdetail: beschrijving, status, stack, links (repo + deploy) bewerken;
  auto-opslaan lokaal + in cloud
- Roadmap-editor: fasen toevoegen/hernoemen/verwijderen; mijlpalen afvinken,
  bewerken, sorteren; voortgangsbalk per fase en totaal
- Claude Code-integratie:
  - `useClaudeStatus` bewaakt actieve Claude-sessies per project (live statusbadge)
  - "Start met Claude" opent een terminal met projectcontext + roadmap als prompt
  - `buildClaudePrompt` genereert gestructureerde context (beschrijving + open mijlpalen)
- Terminal dock (xterm.js + Rust PTY): geïntegreerde terminal per project,
  meerdere sessies naast elkaar, gefocust op de root-map van het project
- Project starten: run-commando uitvoeren (auto-detectie of handmatig);
  wacht op poort, opent browser bij dev-URL
- Geplande sprint-starts: fase inplannen op datum/tijd (`SchedulePicker`,
  `Phase.scheduledAt`) — Claude pakt de sprint automatisch op zodra het
  moment aanbreekt
- **Kwaliteit checken:** knoppen "Code checken" en "Design checken" in het
  projectdetail — laat Claude de codebase resp. de UI/UX doorlichten op
  netheid/veiligheid resp. visuele consistentie en informatiedichtheid; eigen
  `designInstructies`-veld per project naast de bestaande `claudeInstructies`
- GitHub-koppeling: parse SSH/HTTPS remote-URL; verwijder repo via GitHub REST API
- Project verwijderen: lokale meta, cloud-record, optioneel GitHub-repo
- Licht/donker thema toggle

---

## Sprint 5 — Dagelijks gebruik & UX-polish 🔜

**Doel:** de app voelt af voor dagelijks gebruik op één machine.

**Klaar:**
- [x] **Onboarding:** lege-staat-scherm na installatie (nog geen root-map) met
      gerichte uitleg en een "Voeg map toe"-knop
- [x] **Divergentie-markering:** bij het openen van een project dat op meerdere
      PC's staat en niet in sync is, toont de UI een duidelijke banner met uitleg
- [x] **Instellingen — machine-label:** label en hostnaam zichtbaar in Instellingen
- [x] **Mijlpaal direct afvinken vanaf het dashboard:** de eerstvolgende
      openstaande mijlpaal staat met checkbox op de projectkaart, zonder het
      project te hoeven openen
- [x] **Projectdetail-layout:** responsive 1/2/3-koloms grid (i.p.v. vaste
      2 kolommen die uitrekten naar de hoogste buur); alle panelen
      in-/uitklapbaar met compacte samenvatting, onthouden per project
- [x] **Design-pass:** marineblauw is nu de dragende kleur (navigatiebalk,
      primaire knop, merk) en de teal uitsluitend signaal — voortgang, in
      sync, Claude actief. Alle zachte vlakken/randen komen uit tokens per
      thema; er staat geen losse `rgba()` meer in een regel, waardoor de
      lichte modus niet langer tinten uit de donkere modus gebruikte.
- [x] **Toegankelijkheid:** één `:focus-visible`-ring voor de hele app (de
      formuliervelden hadden `outline:none` zonder vervanging, het zoekveld
      had helemaal geen focusindicator); projectkaart, terminal-tabs en
      link-pills zijn echte knoppen en dus met het toetsenbord te bedienen;
      `prefers-reduced-motion` zet de decoratieve animaties uit.

**Open:**
- [ ] **Auto-rescan:** herscant op instelbaar interval (bijv. 5 min) via een
      instelling in de UI — zodat de git-stand vanzelf bijblijft
- [ ] **"Drifting" badge:** als status "actief" is maar >14 dagen geen commit
      binnenkwam, toon een automatische waarschuwingsbadge op de kaart

---

## Sprint 6 — Ambient & notificaties

**Doel:** de app werkt op de achtergrond en stuurt je naar de juiste plek
zonder dat je zelf hoeft te navigeren.

**Klaar:**
- [x] **Autonome scheduler voor geplande sprint-starts:** het afvuren van een
      geplande fase gebeurt niet meer via `setInterval` in de webview (die
      macOS throttlet zodra het venster occluded is, bijv. bij een
      vergrendeld scherm), maar via een OS-thread in de Rust-backend
      (`schedule.rs`) die onafhankelijk van de webview draait en het
      Claude-proces detached spawnt (`pty::spawn_detached`, logt naar
      `~/.projectradar/claude/scheduled-*.log`). Getest: een sprint start nu
      op tijd, ook met een vergrendeld scherm — mits het project al minstens
      één keer handmatig door Claude is geopend (eenmalige "vertrouw je deze
      map?"-prompt staat los van `--dangerously-skip-permissions`, en er is
      niemand om die te bevestigen tijdens een onbeheerde run).

**Open:**
- [ ] **System tray:** app blijft actief in het systeemvak bij venster sluiten;
      toont de 5 meest recente projecten met inline statusbadge (Claude busy,
      uncommitted, out-of-sync) — `tauri-plugin-tray-icon`
- [ ] **Globale sneltoets (Cmd+Shift+R):** spotlight-achtig projectkiezer-venster
      dat boven andere apps zweeft; fuzzy-zoeken, Enter opent het project of
      start de dev-server — `tauri-plugin-global-shortcut`
- [ ] **Command palette (Cmd+K):** filterpalet binnen de app; acties:
      spring naar project, verander status, start Claude, launch server, kopieer pad
- [ ] **OS-notificaties:** systeem-notificatie via `tauri-plugin-notification`
      bij detectie van divergentie of uncommitted changes na een herscandop;
      notificatie dient als deep-link terug naar het betrokken project
- [ ] **Autostart + window-state:** start met het OS via `tauri-plugin-autostart`
      (instelbaar); herstel venstergrootte/-positie via `tauri-plugin-window-state`

---

## Sprint 7 — Context & workflow

**Doel:** context-switching kosten verlagen; de app weet waar je gebleven was.

- [x] **"Pak de draad op":** één knop in het projectdetail die Claude direct start
      op de eerstvolgende openstaande mijlpaal — inclusief fase-context en instructie
      om de mijlpaal af te vinken in `.projectradar.json` zodra hij klaar is
- [ ] **Parking note per project:** vrij tekstveld "waar ik gebleven was"
      (`parkingNote` in `ProjectMeta`); verschijnt als callout bovenaan het
      projectdetail bij heropening; wordt automatisch meegegeven aan Claude
      als extra context in `buildClaudePrompt`
- [ ] **Cross-project "Active sprint" view:** apart tabblad dat alle openstaande
      mijlpalen over alle projecten aggregeert in één platte lijst, gesorteerd
      op phase target-datum — beantwoordt dagelijks de vraag "wat werk ik vandaag?"
- [ ] **Statistieken-view:** commits/week per project (afgelopen 4 weken),
      totaal actieve projecten, totaal commits — surfaced vanuit de bestaande
      `PcState`-data, geen nieuwe API nodig

---

## Sprint 8 — Git gezondheid

**Doel:** repo-kwaliteit zichtbaar maken zonder extra tooling.

- [x] **Wekelijkse commit-activiteit:** `weekly_commits` in `read_repo` (`git.rs`,
      `rev-list --count --since="7 days ago"`), doorgekoppeld via `RepoInfo`/
      `PcState` en cloud-sync; toont "🔥 N deze week" op de projectkaart als er
      activiteit is — geeft een directe indruk of een project actief of
      stationair is. (Simpeler dan de oorspronkelijk geplande 7-staafjes-
      sparkline per dag; die kan later nog als losse verfijning.)
- [ ] **Verouderde branches:** collecteer alle lokale branches en hun laatste
      commitdatum tijdens de scan; toon een badge op de kaart als er branches
      zijn die >30 dagen niet zijn aangeraakt
- [ ] **TODO/FIXME-telling:** snel grep over bronbestanden tijdens scan
      (beperkt tot bronextensies, slaat `node_modules`/`target` over);
      count zichtbaar in projectdetail en meegegeven aan Claude als context

---

## Sprint 9 — ROADMAP.md koppeling

**Doel:** bidirectionele brug tussen de roadmap-UI en Markdown-bestanden in de repo.

- [ ] **Importeren uit ROADMAP.md:** parseer een bestaand `ROADMAP.md` in de
      repo-root (`##` = fase, `- [ ]`/`- [x]` = mijlpalen); eenmalige import,
      niet live-sync — slaat bestaande roadmap-data in de UI niet over
- [ ] **Exporteren naar ROADMAP.md:** schrijf de huidige roadmap-UI terug als
      Markdown; maakt `.projectradar.json` optioneel voor teams die liever
      file-based werken

---

## Sprint 10 — Distributie

**Doel:** installeerbaar en zelf-updatend op macOS; optioneel cross-platform.

- [ ] App-icon (1024×1024, marineblauw stijl)
- [ ] macOS code-signing + notarisatie (Apple Developer account vereist)
- [ ] Auto-update via Tauri updater plugin (`tauri-plugin-updater`)
- [ ] GitHub Actions build-pipeline: `.dmg` voor macOS, optioneel `.msi` / `.AppImage`
- [ ] Splash-scherm of snelle laadtoestand zodat de app niet wit flitst bij opstarten

---

## Checklist PocketBase-hosting

| Stap | Status |
|---|---|
| PocketBase binary downloaden (`pocketbase/README.md`) | 🔲 |
| Collecties aanmaken via `pocketbase/setup.mjs` | 🔲 |
| `.env` met `VITE_PB_URL` instellen per PC | 🔲 |
| Inloggen in de app onder Instellingen → Cloud-sync | 🔲 |
| Optioneel op VPS draaien voor sync over PC's | 🔲 |
