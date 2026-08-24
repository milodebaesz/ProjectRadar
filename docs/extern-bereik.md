# Extern bereik — ProjectRadar op je iPhone

De mobiele pagina ([`src-tauri/assets/remote.html`](../src-tauri/assets/remote.html))
kent twee bronnen en schakelt automatisch:

| Modus | Bron | Wanneer | Wat kan je |
|---|---|---|---|
| **Live** | de Mac, via Tailscale | Mac aan en bereikbaar | Alles: status zien, mijlpalen afvinken, Claude starten |
| **Cloud** | PocketBase op je VPS | Mac uit of onbereikbaar | Alleen lezen: projecten, git-stand, roadmap-voortgang |

De pagina probeert elke 4 seconden eerst de Mac (timeout 2,5 s) en valt anders
terug op de cloud. Komt de Mac weer online, dan schakelt hij vanzelf terug.

> **Waarom alleen lezen in cloud-modus?** De desktop-app haalt de roadmap uit
> de cloud én schrijft 'm terug (`fetchProjects` / `saveProjectMeta` in
> [`src/lib/sync.ts`](../src/lib/sync.ts)). Zou de telefoon met de Mac uit ook
> schrijven, dan kan een latere sync die wijziging overschrijven. Dat risico is
> het afvinken-op-afstand niet waard; live-modus kan het wél veilig.

---

## Waarom deze opzet

Drie losse stukken, die je onafhankelijk van elkaar kunt opzetten:

1. **De pagina** staat op je bestaande reverse proxy. Daardoor is hij bereikbaar
   ook als de Mac uit staat — werd hij door de Mac zelf geserveerd, dan kon je
   hem in dat geval niet eens laden.
2. **De data bij Mac-uit** komt uit PocketBase op je VPS.
3. **De acties** gaan rechtstreeks naar je Mac over Tailscale.

Stap 3 moet over **HTTPS**, niet over `http://100.x.y.z:4174`. Een pagina die
via HTTPS geladen is, mag van Safari geen HTTP-adressen aanroepen (mixed
content). `tailscale serve` lost dat op met een echt certificaat.

---

## 1. PocketBase op de VPS

Volg [`pocketbase/README.md`](../pocketbase/README.md) → *Op je VPS*. PocketBase
is één Go-binary van zo'n 50 MB geheugen en draait prima naast wat er al staat.

Zet daarna op je Mac in `.env` (naast `.env.example`):

```bash
VITE_PB_URL=https://pb.jouwdomein.nl
```

Herstart de app en log in onder **Instellingen → Cloud-sync**. Pas ná een
eerste sync staat er data in de cloud om op terug te vallen.

## 2. De pagina op je reverse proxy

Kopieer het bestand naar de VPS:

```bash
scp src-tauri/assets/remote.html jouwvps:/var/www/radar/index.html
```

Caddy:

```caddyfile
jouwdomein.nl {
    handle_path /radar/* {
        root * /var/www/radar
        file_server
    }
}
```

Nginx:

```nginx
location /radar/ {
    alias /var/www/radar/;
    index index.html;
}
```

> De pagina staat op één plek in de repo maar draait op twee: de Rust-server
> serveert 'm ook zelf (`include_str!` in [`remote.rs`](../src-tauri/src/remote.rs)),
> zodat direct verbinden zonder proxy blijft werken. Wijzig je de pagina, kopieer
> hem dan opnieuw naar de VPS én bouw de app opnieuw.

## 3. Tailscale HTTPS vóór de Mac

Eenmalig in de Tailscale-beheerconsole: zet **MagicDNS** en **HTTPS
Certificates** aan.

Dan op de Mac:

```bash
tailscale serve --bg --https=443 http://127.0.0.1:4174
```

Controleer het adres dat je terugkrijgt:

```bash
tailscale serve status
```

Dat is de URL (bijv. `https://macbook.jouw-tailnet.ts.net`) die je straks in de
app invult. Zorg dat Tailscale ook op je iPhone geïnstalleerd en ingelogd is.

---

## 4. De pagina koppelen

Open `https://jouwdomein.nl/radar/` op je iPhone en vul in:

**Mac — direct bedienen**
- Adres: de URL uit `tailscale serve status`
- Token: ProjectRadar → **Instellingen → Extern bereik**

**Cloud — terugval** (optioneel)
- Adres: `https://pb.jouwdomein.nl`
- E-mail en wachtwoord van je app-gebruiker (dezelfde als bij Cloud-sync)

Zet de pagina daarna op je beginscherm via **Deel → Zet op beginscherm**, dan
opent hij als een app. Instellingen zijn later aan te passen via ⚙ rechtsboven.

---

## Beveiliging

- De Rust-server bindt **uitsluitend** aan het Tailscale-IP (CGNAT-bereik
  100.64.0.0/10), nooit aan `0.0.0.0` — hij is dus niet bereikbaar via je
  gewone thuisnetwerk. Zonder Tailscale-interface start hij niet.
- Elk verzoek vereist daarnaast een Bearer-token uit de OS-keychain.
- Vermoed je dat het token gelekt is: **Instellingen → Extern bereik → nieuw
  token**. Daarna de telefoon opnieuw koppelen.
- De cloud-sessie is een gewone PocketBase-token in `localStorage` van je
  telefoon; die verloopt vanzelf en vraagt dan opnieuw om inloggen.

## Problemen

| Symptoom | Oorzaak |
|---|---|
| "Mac niet bereikbaar", ook met Mac aan | Tailscale uit op telefoon of Mac; of `tailscale serve` draait niet |
| Blijft in cloud-modus hangen | Adres van de Mac is `http://` in plaats van `https://` — Safari blokkeert dat |
| "Cloud-login mislukt" | Verkeerde gegevens, of PocketBase-URL zonder HTTPS |
| Lege lijst in cloud-modus | Nog nooit gesynct — draai eerst een scan op de Mac met `VITE_PB_URL` gezet |
| "Token ongeldig" | Token opnieuw gegenereerd in de app; koppel de telefoon opnieuw |
