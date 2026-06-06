# Projectradar

Desktop-app die per PC je lokale git-projecten scant en de stand centraal
samenbrengt, zodat je vanaf elke machine één actueel overzicht hebt van al je
programmeerprojecten — doel, status, stack, links, roadmap en welke PC welke
versie/branch heeft.

Zie [PRD.md](PRD.md) voor de volledige product-omschrijving.

## Stack

- **Tauri 2** (desktop-shell + lokale git-/bestandstoegang in Rust)
- **React 19 + TypeScript + Vite**
- **PocketBase** (optioneel, zelf-gehost: centrale database/auth voor sync over
  meerdere PC's)

## Ontwikkelen

Vereisten: Node.js, npm, Rust (`rustup`), en de
[Tauri-systeemvereisten](https://tauri.app/start/prerequisites/).

```bash
npm install
npm run tauri dev     # start de desktop-app met hot reload
npm run tauri build   # bouwt een installeerbare app
```

`npm run dev` start alleen de webfrontend (browser-preview). De git-scan werkt
uitsluitend in de desktop-app, omdat die toegang tot het bestandssysteem nodig
heeft.

## Hoe het werkt

1. Stel onder **Instellingen** één of meer root-mappen in (bijv. `~/programms`).
2. De Rust-backend (`src-tauri/src/git.rs`) zoekt daarin git-repo's en leest per
   repo de stand uit via de `git` CLI: branch, laatste commit, totaal aantal
   commits, niet-gecommitte wijzigingen en ahead/behind t.o.v. de remote. De
   stack wordt globaal herkend aan marker-bestanden (package.json, Cargo.toml…).
3. Mappen zonder git verschijnen apart onder **Nog geen git** met een
   `git init`-actie.
4. In het **projectdetail** verrijk je elk project met doel, status, stack,
   links en een roadmap (fasen + afvinkbare mijlpalen). Deze velden worden
   lokaal bewaard (en gesynct zodra Supabase is ingesteld).

## Cloud-sync (optioneel, zelf-gehost)

Zonder PocketBase draait Projectradar volledig lokaal op deze PC. Voor één gedeeld
overzicht over meerdere PC's gebruik je een zelf-gehoste PocketBase (één binary):

1. Volg [`pocketbase/README.md`](pocketbase/README.md) om PocketBase lokaal of op
   je VPS te draaien en de collecties aan te maken (`pocketbase/setup.mjs`).
2. Kopieer `.env.example` naar `.env` en zet `VITE_PB_URL` op je PocketBase-URL.
3. Log in de app in onder **Instellingen → Cloud-sync**; elke PC met hetzelfde
   account deelt het overzicht.

## Projectstructuur

```
src/                 React-frontend
  components/         Sidebar, Dashboard, ProjectCard, ProjectDetail, Settings
  lib/                tauri-bridge, storage, pocketbase, sync, model, format
  types.ts            gedeelde types
src-tauri/src/
  lib.rs              Tauri-commands (scan_roots, git_init, machine_info)
  git.rs              git-scan + stack-detectie
pocketbase/          self-host setup: setup.mjs (collecties) + README (VPS-deploy)
design/              originele design-mockup
```
