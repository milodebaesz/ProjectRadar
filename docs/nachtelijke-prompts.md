# Nachtelijke prompts (PromptPad)

Elke nacht tussen 03:00 en 06:00 haalt Projectradar openstaande prompts op uit
PromptPad (de Chrome-extensie in `../PromptPad`, tabel `pp_prompts` in jouw
Supabase-project), matcht ze op projectnaam, en voert ze **strikt na elkaar**
uit via Claude Code — ook over projecten heen. (Was eerst parallel per
project; dat liet meerdere `claude`-processen tegelijk om CPU/geheugen
concurreren en liep in de praktijk vast — zie de code-comment bij `run_batch`
in `nightly.rs`.) Een geslaagde prompt wordt gemarkeerd als `done`; anders
`failed`, met de laatste output als `error`-context.

> **Belangrijke gedragsverandering.** Tot nu toe was een PromptPad-prompt iets
> dat je zelf kopieerde en plakte — jij was de laatste check. Met dit aan
> wordt **elke nieuwe prompt automatisch en onbeheerd uitgevoerd**, zonder dat
> je 'm nog hoeft te bevestigen. Schrijf geen prompt in PromptPad die je niet
> ongezien wil laten draaien.

## Waarom een Rust-achtergrondthread

Een vergrendeld scherm laat macOS het app-venster als "occluded" behandelen,
wat JavaScript in de webview throttlet — precies de reden waarom de geplande
sprint-starts ([ROADMAP.md](../ROADMAP.md), Sprint 6) ook al buiten de webview
draaien. `caffeinate` voorkomt dat de Mac in slaap valt, maar niet die
throttling. De aandrijving zit daarom in Rust
([`src-tauri/src/nightly.rs`](../src-tauri/src/nightly.rs)); de terminal-dock
in de webview is een **venster erop**, niet de motor. Sessies die starten
terwijl niemand kijkt, mis je dus niet — ze verschijnen zodra de app weer
actief is.

## Opzet

### 1. Database-migratie

`pp_prompts` heeft een `status`/`started_at`/`finished_at`/`error`-kolom
nodig. Voer [`../PromptPad/supabase-schema.sql`](../../PromptPad/supabase-schema.sql)
opnieuw uit in je Supabase SQL-editor — de `alter table … if not exists`-regels
zijn veilig op een bestaande database.

### 2. Instellingen invullen

**Projectradar → Instellingen → Nachtelijke prompts (PromptPad)**:
- **Supabase-URL**: dezelfde als in PromptPad's eigen instellingen
  (`https://xxxx.supabase.co`).
- **Publishable / anon key**: idem — dezelfde sleutel die de extensie al
  gebruikt (RLS staat uit op deze tabellen, dus deze sleutel geeft al
  volledige toegang; er verandert niets aan het beveiligingsmodel).

De sleutel gaat naar de OS-keychain en komt nooit terug naar de webview —
wijzigen kan, teruglezen niet.

### Status controleren

Onder de uitlegtekst in dit paneel staan twee regels:

- **"Achtergrondlus actief · voor het laatst X geleden"** — bewijst dat de
  OS-thread leeft (wordt elke minuut bijgewerkt, ongeacht of er iets te doen
  is). Staat dit op iets ouds (uren) terwijl de app open is: de thread is om
  wat voor reden dan ook gestopt.
- **"Laatste run: X geleden — <samenvatting>"** — wanneer de batch voor het
  laatst draaide (gepland óf via "Nu uitvoeren") en wat hij vond/deed, bijv.
  *"3 pending prompt(s) gevonden, 3 gematcht, 3 gestart."*

Beide staan in `~/.projectradar/nightly-status.json` en overleven een
gesloten terminal — bruikbaar om de ochtend na een nachtrun te checken of
alles is gegaan zoals verwacht, zonder dat je de terminal-scrollback nog
open hoeft te hebben.

### 3. Zorg dat de Mac blijft draaien

```bash
caffeinate -s
```

Voorkomt slaap, niet dat je de app afsluit. **Sluit Projectradar niet met
Cmd+Q** — dat beëindigt het hele proces, inclusief de achtergrondthread. Het
venster sluiten is genoeg; de app blijft dan actief (net als de meeste
macOS-apps).

## Hoe het matcht

Projectnaam (`pp_projects.name`) wordt genormaliseerd zoals overal in
Projectradar (`trim().toLowerCase()`, zie `project_key` in
[`git.rs`](../src-tauri/src/git.rs)) en vergeleken met de projectsleutel. Geen
match — bijvoorbeeld omdat het project op deze Mac nog nooit gescand is, of de
naam net anders gespeld is — dan wordt de prompt als `failed` gemarkeerd met
een duidelijke reden, in plaats van elke nacht opnieuw geprobeerd te worden.

## Testen zonder tot 3 uur te wachten

**Instellingen → Nu uitvoeren** negeert het tijdvenster en de
"vandaag al gedraaid"-markering.

## Beperkingen

- **Geen per-prompt uitzondering.** Elke `pending`-prompt wordt opgepikt —
  er is (nog) geen manier om een prompt in PromptPad te schrijven zonder 'm
  voor de nachtrun te queuen. Wil je dat, dan is dat een aanpassing in de
  PromptPad-extensie zelf (niet in deze sessie meegenomen).
- **"Geslaagd" = Claude's exit-code**, niet een inhoudelijke check. Een `done`
  betekent dat Claude niet crashte of werd afgebroken — niet per se dat de
  taak goed is uitgevoerd. Controleer belangrijke runs even in de
  terminal-dock.
- **Geen statusweergave in de PromptPad-extensie zelf** — die tabel-kolommen
  zijn er, maar de extensie toont ze nog niet. Voor nu: bekijk `status`/
  `error` via de Supabase table editor, of de terminal-dock in Projectradar.
- **Output is begrensd** op 1 MB per sessie (het begin wordt afgekapt, niet
  het eind — een fout staat meestal aan het eind).
- **Alleen-lezen weergave.** De terminal-tab van een nachtelijke run toont
  live mee, maar je kunt er niet in typen — hij drijft niets aan, hij toont
  alleen.
- **Één Mac.** De runner draait op de machine waar Projectradar open staat;
  er is geen coördinatie tussen meerdere Mac's als je Projectradar op meer
  dan één machine gebruikt.
