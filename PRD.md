# PRD: Projectradar

*Opgesteld op 2026-06-05 · Status: concept · Versie 0.1*

> Werknaam "Projectradar" — nog te bevestigen.

## 1. Samenvatting
Projectradar is een desktop-app die per PC je lokale git-projecten automatisch
scant en de stand doorstuurt naar een centrale cloud-database. Daardoor heb je
vanaf elke machine één compleet overzicht van al je programmeerprojecten: hun
doel, status, stack, links en roadmap, én op welke PC welke versie/branch staat.
Het lost het probleem op dat je code verspreid is over meerdere PC's zonder
centraal zicht op wat waar staat en hoe ver het is.

## 2. Probleem & context
- Je werkt op meerdere PC's en hebt op elke machine mappen vol projecten.
- Er is geen centraal overzicht: je weet niet in één oogopslag welke projecten je
  hebt, wat hun status is, of welke versie op welke PC staat.
- Wanneer je op twee PC's aan hetzelfde project werkt, mis je zicht op welke
  machine voor- of achterloopt.
- Nu wordt dit "opgelost" door handmatig in mappen en git te kijken per PC —
  omslachtig en foutgevoelig.

**Visie:** altijd, vanaf elke machine, een mooi en actueel overzicht van al mijn
projecten — versie, status, doel en planning op één plek.

## 3. Doelen & succescriteria
**Doelen**
- Eén centraal, altijd-actueel overzicht van alle projecten over alle PC's heen.
- Automatisch git-informatie per project verzamelen, zonder handwerk.
- Per project doel, status, stack, links en roadmap (fasen + mijlpalen) bijhouden.
- Direct zien welke PC welke versie/branch van een project heeft, en of er
  verschillen zijn.

**Succesmetrieken**
- Na het instellen van een root-map verschijnen alle git-projecten van die PC
  automatisch in het overzicht.
- Bij een project dat op 2 PC's staat is in één oogopslag te zien welke voorloopt.
- Het overzicht is vanaf elke gekoppelde PC identiek en up-to-date.

**Non-goals (buiten scope)**
- Geen volwaardig multi-user platform met rollen/rechten (wel: later een project
  kunnen delen/laten meekijken).
- Geen vervanging van Git of een Git-hostingdienst (GitHub/GitLab); we lezen
  alleen uit, we hosten geen repo's.
- Geen issue-tracker of volwaardig projectmanagement-tool; de roadmap blijft licht.
- Geen automatische code-sync tussen PC's (dat doet git/remote zelf).

## 4. Doelgroep & gebruikers
**Primair: jij** — ontwikkelaar die op meerdere PC's werkt, comfortabel met git en
de terminal, en behoefte heeft aan overzicht zonder gedoe.

**Secundair (later): meekijkers** — iemand met wie je incidenteel een project wilt
delen of laten meekijken (read-only of beperkt). Geen kernfunctie voor de MVP.

## 5. Scope & functionaliteit
**MVP (must-have)**
- Desktop-app (Tauri) installeerbaar per PC.
- Per PC één of meer instelbare root-mappen die automatisch worden afgezocht naar
  git-projecten.
- Automatische git-scan per project: laatste commit-datum + boodschap, huidige
  branch, totaal aantal commits, niet-gecommitte wijzigingen (ja/nee), en
  voor-/achterstand t.o.v. de remote.
- Centrale Supabase-database waar elke PC zijn stand naartoe stuurt.
- Centraal projectoverzicht (vanaf elke PC gelijk), met per project de status op
  elke gekoppelde PC.
- Handmatige projectvelden: naam, beschrijving/doel, status-label
  (idee / actief / on hold / afgerond), stack/taal, links (repo, deploy).
- Roadmap per project: fasen (bijv. MVP, v1, v2) met mijlpalen en optionele
  streefdatum, afvinkbaar.
- PC-identificatie: elke machine herkenbaar gekoppeld aan jouw account.

**Later (should / could)**
- **Overzicht van niet-git-mappen:** tijdens de scan ook de mappen in je
  root-mappen vinden die (nog) géén git-repo zijn, en die apart tonen als lijst
  "nog geen git". Per map een knop om `git init` uit te voeren of de map handmatig
  als project toe te voegen.
- Een project delen / laten meekijken (read-only) door een ander.
- Notificaties/markeringen bij divergentie tussen PC's (bijv. uncommitted changes
  laten staan).
- Filteren/sorteren/zoeken in het overzicht (op status, stack, laatst gewijzigd).
- Statistieken (bijv. activiteit per project, aantal actieve projecten).
- Tags/categorieën voor projecten.

## 6. Belangrijkste gebruikersflows
**Flow 1 — PC koppelen en scannen**
1. Je installeert de app op een PC en logt in op je account.
2. Je stelt één of meer root-mappen in (bijv. `/Users/mkb/programms`).
3. De app scant de mappen, vindt alle git-repo's en leest hun git-stand uit.
4. De projecten verschijnen in het centrale overzicht, gekoppeld aan deze PC.

**Flow 2 — Overzicht bekijken**
1. Je opent de app op een willekeurige gekoppelde PC.
2. Je ziet alle projecten met status, doel, stack en laatste activiteit.
3. Bij een project dat op meerdere PC's staat zie je per PC de versie/branch en
   wie voor- of achterloopt.

**Flow 3 — Project verrijken met doel & roadmap**
1. Je opent een project in de app.
2. Je vult/bewerkt beschrijving, doel, status-label, stack en links.
3. Je stelt een roadmap op met fasen en mijlpalen, en vinkt voltgang af.

## 7. Design & UX
**Sfeer & stijl**
- Modern, niet generiek/AI-achtig, met een **marineblauw kleurenpalet** (conform
  vaste voorkeur). Diep marineblauw als basis, met één heldere accentkleur voor
  acties/highlights (bijv. een fris cyaan of teal).
- **Lichte én donkere modus**, met een toggle. Lichte modus is de standaard
  (persoonlijke voorkeur, sluit aan bij Goalflow); donkere modus als alternatief.
  Marineblauw blijft in beide de identiteit: in lichte modus als donkere
  tekst/accenten op een rustige lichte achtergrond, in donkere modus als basiskleur.
- Strak, rustig, met veel witruimte; data-dicht waar nodig maar nooit druk.
  Subtiele kaarten/panelen, duidelijke typografie, monospace voor commit-hashes en
  branch-namen.

**Belangrijkste schermen**
- **Dashboard/overzicht:** alle projecten als kaarten of compacte lijst. Per
  project: naam, status-badge (kleurgecodeerd: idee/actief/on hold/afgerond),
  stack-iconen, laatste activiteit, en kleine PC-badges die tonen op welke PC's
  het staat. Aparte sectie/tab "nog geen git" voor niet-git-mappen.
- **Projectdetail:** doel/beschrijving bovenaan; daaronder status, stack, links;
  een **per-PC blok** dat per machine branch + laatste commit + ahead/behind toont
  en verschillen visueel markeert (bijv. "desktop loopt 3 commits voor"); en een
  **roadmap-sectie** met fasen en afvinkbare mijlpalen.
- **Instellingen:** gekoppelde PC's, root-mappen per PC, account, scan-gedrag.

**Visuele taal voor de kern (multi-PC-status)**
- Statussen kleurgecodeerd en met icoon, niet alleen kleur (toegankelijkheid).
- Divergentie tussen PC's krijgt een duidelijke, kalme waarschuwingsstijl —
  opvallend genoeg om te zien, niet alarmerend.

**UX-uitgangspunten**
- Overzicht staat centraal: in één oogopslag zien wat de staat van je projecten is.
- Scannen gebeurt op de achtergrond met een subtiele voortgangsindicator; de UI
  blokkeert niet.
- Snelle acties dichtbij (open in editor/terminal, `git init`, naar repo/deploy).

**Toegankelijkheid:** geen bijzondere doelgroep-eisen; wel goede leesbaarheid,
voldoende contrast en niet uitsluitend op kleur leunen als basis.

## 8. Randvoorwaarden & constraints
- **Stack:** Tauri (desktop-shell + bestandssysteem/git-toegang), React-frontend,
  Supabase als centrale database/auth.
- **Git-toegang:** de app moet lokaal git-repo's kunnen uitlezen (via git-commando's
  of een git-library).
- **Privacy:** alleen jouw eigen projectmetadata gaat naar de cloud; geen
  broncode. Let op dat commit-boodschappen/paden gevoelige info kunnen bevatten —
  bewust kiezen wat wel/niet wordt gesynct.
- **Platform:** in elk geval macOS (jouw huidige machine); idealiter
  cross-platform (Tauri ondersteunt dit).
- **Praktisch:** soloproject, geen harde deadline; MVP eerst, daarna uitbreiden.

## 9. Risico's & aannames
- **Risico:** betrouwbaar git-repo's vinden en uitlezen over verschillende
  mapstructuren/PC's heen. → Begin met git via CLI-commando's; dek edge-cases
  (geen remote, detached HEAD, submodules) stap voor stap af.
- **Risico:** "welke PC loopt voor" correct bepalen zonder de repo's zelf te
  syncen. → Baseer op commit-hash/-datum en ahead/behind t.o.v. de gedeelde
  remote; toon ruwe feiten i.p.v. te gokken.
- **Risico:** gevoelige info (paden, commit-tekst) lekt naar de cloud. → Minimaal
  syncen, bewuste keuze welke velden, evt. instelbaar.
- **Aanname:** projecten zijn (vrijwel) altijd git-repo's. Niet-git-mappen vallen
  buiten de automatische scan (evt. later handmatig toevoegen).
- **Aanname:** je gebruikt voor gedeelde projecten een gemeenschappelijke remote
  (GitHub e.d.) als referentiepunt.
- **Aanname:** Supabase volstaat voor opslag én account-koppeling van je PC's.

## 10. Open vragen
- Definitieve naam van de app (werknaam: Projectradar).
- Welke git-velden minimaal vs. optioneel syncen (privacy-afweging).
- Hoe een PC zich identificeert/koppelt (apparaatnaam, handmatig label, eenmalige
  koppelcode?).
- (Opgelost) Niet-git-projecten worden apart getoond met de optie `git init` of
  handmatig toevoegen — detailgedrag nog uit te werken.
- (Deels besloten) De app houdt de data **automatisch actueel**: re-scant en synct
  zodat git-stand en status vanzelf bijblijven. De exacte trigger (bij opstarten /
  op interval / file-watcher / handmatig knopje) is nog een detailkeuze.
- Detailniveau van het "delen met anderen" wanneer dat later aan de beurt komt.

## 11. Globale mijlpalen
1. **Fundament:** Tauri + React project opzetten, Supabase-schema (projecten, PC's,
   roadmap) en authenticatie/PC-koppeling.
2. **Lokale git-scan:** root-mappen instellen, repo's vinden, git-stand uitlezen.
3. **Sync:** lokale scan-resultaten naar Supabase pushen en ophalen.
4. **Overzicht:** dashboard met alle projecten en per-PC versie-status.
5. **Verrijking:** projectdetail met doel, status, stack, links en roadmap
   (fasen + mijlpalen).
6. **Polish:** design (marineblauw, modern), filteren/zoeken, edge-cases.
7. **Later:** delen/meekijken, notificaties, statistieken.
