Je staat in de root van een bestaand project. Genereer (of update) `.projectradar.json` zodat het ProjectRadar-dashboard meer context kan tonen op de overzichtskaart en de detailpagina.

# Stap 1 — Onderzoek
Lees zelfstandig:
- `README.md`, `PRD.md`, `docs/`, `CHANGELOG.md` als die bestaan
- `package.json` / `pyproject.toml` / `Cargo.toml` / `go.mod` (afhankelijk van stack)
- Het topniveau van `src/` of equivalent (alleen mapnamen + 1-2 entry files)
- `git log --oneline -20` voor recente richting
- Bestaande `.projectradar.json` als die er al is — niet overschrijven, **mergen**

Vraag niets aan mij; baseer alles op wat je leest. Als iets écht niet af te leiden is, laat het veld weg (niet raden).

# Stap 2 — Schrijf `.projectradar.json`
Volg dit schema exact. Velden zijn optioneel; sla over wat je niet weet.

```json
{
  "key": "<genormaliseerde projectnaam, lowercase, kebab-case>",
  "description": "<2-4 zinnen: wat is dit, voor wie, wat is het probleem dat het oplost. Geen marketing-taal, geen 'leverages'/'utilizes'.>",
  "status": "idee | actief | onhold | afgerond",
  "stack": ["<aanvullingen of correcties op auto-detectie — bv. 'Tauri', 'PocketBase', 'Postgres'>"],
  "links": {
    "repo": "<git remote URL als die ontbreekt in git config>",
    "deploy": "<productie-URL als je die in README/docs vindt>"
  },
  "runCommand": "<alleen invullen als het niet 'npm run dev' / 'cargo run' / het auto-gedetecteerde commando is>",
  "devUrl": "<alleen invullen als de poort afwijkt van het framework-default>",
  "roadmap": [
    {
      "id": "<korte slug, bv. 'mvp'>",
      "name": "<fase-naam>",
      "target": "<optioneel: vrije tekst of YYYY-MM-DD>",
      "milestones": [
        { "id": "<slug>", "text": "<concrete, afvinkbare taak>", "done": <true als al klaar volgens code/commits> }
      ]
    }
  ]
}
```

# Stap 3 — Roadmap-regels
De roadmap is het belangrijkste — daar leeft de detailpagina van.
- **3-6 fasen**, chronologisch. Voorbeelden van faseringen: `Fundering → MVP → Polish → Launch → Post-launch`, of feature-georiënteerd als dat beter past.
- **Per fase 3-8 mijlpalen.** Mijlpalen zijn concrete deliverables ("Auth-flow werkt end-to-end"), geen vage thema's ("Backend verbeteren").
- **Markeer `done: true`** als er bewijs in de code/commits is dat het al klaar is. Verzin geen voortgang.
- Schrijf mijlpaal-tekst in dezelfde taal als de bestaande README (NL of EN).

# Stap 4 — Aflevering
- Schrijf het bestand met `Write` naar `.projectradar.json` in de repo-root.
- Print daarna een korte samenvatting: aantal fasen, aantal mijlpalen, % al klaar, en welke velden je bewust hebt overgeslagen en waarom.
- Voeg `.projectradar.json` **niet** automatisch toe aan `.gitignore` — laat de gebruiker zelf kiezen of het mee moet in de repo.

Niet doen: README aanpassen, code wijzigen, dependencies toevoegen, of een nieuwe commit maken.
