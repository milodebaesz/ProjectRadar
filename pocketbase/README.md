# PocketBase voor Projectradar

Projectradar gebruikt [PocketBase](https://pocketbase.io) (één Go-binary) als
centrale database + auth, zodat je je projecten over meerdere PC's synchroniseert.
Hetzelfde binary draait lokaal (testen) en op je VPS (productie).

De collecties (`machines`, `projects`, `project_states`) en toegangsregels worden
aangemaakt door [`setup.mjs`](setup.mjs) — herbruikbaar voor zowel lokaal als VPS.

> `pocketbase/pocketbase` (binary) en `pocketbase/pb_data` staan in `.gitignore`.

---

## Lokaal testen

```bash
# 1. Binary downloaden (macOS amd64; kies arm64 op Apple Silicon)
cd pocketbase
curl -sL -o pb.zip https://github.com/pocketbase/pocketbase/releases/download/v0.39.1/pocketbase_0.39.1_darwin_amd64.zip
unzip -o pb.zip && rm pb.zip

# 2. Superuser (admin) aanmaken
./pocketbase superuser create admin@projectradar.local 'EEN-STERK-WACHTWOORD'

# 3. Server starten
./pocketbase serve --http=127.0.0.1:8090

# 4. In een tweede terminal: collecties + een app-gebruiker aanmaken
cd ..
PB_URL=http://127.0.0.1:8090 \
PB_ADMIN_EMAIL=admin@projectradar.local \
PB_ADMIN_PASS='EEN-STERK-WACHTWOORD' \
APP_USER_EMAIL='jij@voorbeeld.nl' APP_USER_PASS='jouw-app-wachtwoord' \
node pocketbase/setup.mjs
```

Zet daarna in de app-`.env`: `VITE_PB_URL=http://127.0.0.1:8090`, start
`npm run tauri dev`, en log onder **Instellingen → Cloud-sync** in met de
app-gebruiker.

De admin-UI staat op <http://127.0.0.1:8090/_/>.

---

## Op je VPS (productie)

Aangenomen: een VPS (≥1 GB RAM volstaat ruim), een domein dat naar de VPS wijst
(bijv. `pb.jouwdomein.nl`), en SSH-toegang.

### 1. PocketBase installeren

```bash
sudo useradd -r -s /bin/false pocketbase
sudo mkdir -p /opt/pocketbase && cd /opt/pocketbase
# Kies de juiste Linux-architectuur (amd64 of arm64):
curl -sL -o pb.zip https://github.com/pocketbase/pocketbase/releases/download/v0.39.1/pocketbase_0.39.1_linux_amd64.zip
sudo unzip -o pb.zip && sudo rm pb.zip
sudo chown -R pocketbase:pocketbase /opt/pocketbase
```

### 2. Als service draaien (systemd)

`/etc/systemd/system/pocketbase.service`:

```ini
[Unit]
Description=PocketBase (Projectradar)
After=network.target

[Service]
Type=simple
User=pocketbase
Group=pocketbase
ExecStart=/opt/pocketbase/pocketbase serve --http=127.0.0.1:8090
WorkingDirectory=/opt/pocketbase
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now pocketbase
```

### 3. HTTPS via Caddy (reverse proxy, automatisch TLS-certificaat)

```bash
sudo apt install -y caddy
```

`/etc/caddy/Caddyfile`:

```
pb.jouwdomein.nl {
    reverse_proxy 127.0.0.1:8090
}
```

```bash
sudo systemctl reload caddy
```

> Alternatief: PocketBase kan zelf TLS doen met
> `./pocketbase serve --http="" --https=0.0.0.0:443`, maar een reverse proxy
> (Caddy/nginx) is robuuster naast andere diensten.

### 4. Superuser + collecties aanmaken

```bash
# Superuser (eenmalig)
sudo -u pocketbase /opt/pocketbase/pocketbase superuser create admin@jouwdomein.nl 'STERK-WACHTWOORD'

# Collecties + app-gebruiker (vanaf je laptop of de VPS, met Node + dit repo):
PB_URL=https://pb.jouwdomein.nl \
PB_ADMIN_EMAIL=admin@jouwdomein.nl \
PB_ADMIN_PASS='STERK-WACHTWOORD' \
APP_USER_EMAIL='jij@voorbeeld.nl' APP_USER_PASS='jouw-app-wachtwoord' \
node pocketbase/setup.mjs
```

### 5. De app erop wijzen

Zet op elke PC in de app-`.env`:

```
VITE_PB_URL=https://pb.jouwdomein.nl
```

Bouw/start de app opnieuw en log op elke PC in met dezelfde app-gebruiker — al je
PC's delen nu één overzicht.

---

## Back-ups

Alle data zit in `/opt/pocketbase/pb_data`. Een periodieke back-up daarvan (bijv.
`tar` + cron, of `pocketbase` snapshots) volstaat.
