# Projectradar — projectsamenvatting genereren

Draai deze prompt in de **root van een projectmap** (bv. met `claude` / Claude Code).
Doel: rijke, gestructureerde projectinfo voor Projectradar genereren, in plaats van
de huidige summiere velden.

---

## Prompt (kopieer alles hieronder)

Je bent een technische analist. Analyseer dit project grondig en lever gestructureerde
metadata aan voor "Projectradar" — een dashboard dat mijn programmeerprojecten overzichtelijk toont.

**Onderzoek eerst het project zelf** voordat je iets schrijft:
- Lees `README*`, `PRD*`, `package.json`/`Cargo.toml`/`pyproject.toml` e.d., en config-bestanden.
- Bekijk de mappenstructuur en belangrijkste source-bestanden om de échte stack en features te bepalen.
- Bekijk `git log --oneline -20` en de laatste commits om de huidige stand/voortgang in te schatten.
- Verzin niets: baseer alles op wat daadwerkelijk in de repo staat. Bij onzekerheid kies een conservatieve inschatting.

**Lever twee dingen op:**

### 1. Een bestand `.projectradar.json` in de projectroot

Schrijf exact dit schema (velden mogen leeg/weggelaten als onbekend):

```json
{
  "key": "<mapnaam in lowercase>",
  "description": "<2-4 zinnen: wat het project is, voor wie, en de kernwaarde>",
  "status": "<idee | actief | onhold | afgerond>",
  "stack": ["<concrete technologie>", "..."],
  "links": { "repo": "<git remote url indien aanwezig>", "deploy": "<live url indien bekend>" },
  "roadmap": [
    {
      "id": "<korte unieke slug, bv. fase-1>",
      "name": "<fasenaam, bv. MVP / Beta / v1.0>",
      "target": "<optionele streefdatum of kwartaal, vrije tekst>",
      "milestones": [
        { "id": "<slug>", "text": "<concrete mijlpaal>", "done": true },
        { "id": "<slug>", "text": "<concrete mijlpaal>", "done": false }
      ]
    }
  ]
}
```

Regels:
- `key` = de naam van de huidige map, in lowercase (zo matcht de radar het project).
- `status`: alleen één van `idee`, `actief`, `onhold`, `afgerond`. Kies op basis van commit-activiteit en volledigheid.
- `stack`: concrete technologieën (frameworks, talen, databases, belangrijke libs/API's) — geen vage termen.
- `roadmap`: 2-4 fasen. Markeer mijlpalen die al af zijn als `"done": true` op basis van wat in de repo bestaat; toekomstige werk als `false`. Zorg dat elke `id` uniek is.
- Geldige JSON, geen commentaar, geen trailing comma's.

### 2. Een korte leesbare samenvatting in je antwoord (Nederlands)

- **Productsamenvatting** (2-4 zinnen)
- **Status & onderbouwing** (1 zin waarom je deze status koos)
- **Stack** (bullets)
- **Roadmap** (fasen met afgevinkte/openstaande mijlpalen)

Houd het beknopt en concreet. Klaar als `.projectradar.json` geschreven is.

---

## Gebruik in Projectradar

De radar leest `.projectradar.json` **automatisch** in tijdens de scan. Flow:

1. Draai deze prompt in een repo → er verschijnt een `.projectradar.json` in de root.
2. Open/ververs Projectradar (of klik "Scan") → de velden staan er meteen op.

Geen handwerk nodig. Het bestand wint per ingevuld veld van de handmatige cache, dus opnieuw
genereren verrijkt de radar zonder iets te overschrijven dat jij in de app hebt ingevuld.

> Let op: dit werkt nu in de **lokale weergave**. Bij ingelogde PocketBase-sync toont de radar
> de cloud-velden; die kun je in het detailscherm bijwerken (sync van `.projectradar.json` naar
> de cloud kan later toegevoegd worden).
