---
description: Start (of herstart) de ProjectRadar dev-app
---

Start de Projectradar Tauri dev-app opnieuw op.

1. Sluit eventueel al draaiende instanties af, zodat er nooit twee tegelijk lopen:
   - `pkill -f "target/debug/projectradar"` (dev-build)
   - `pkill -f "/Applications/Projectradar.app"` (geïnstalleerde build)
   - `pkill -f "target/release/bundle/macos/Projectradar.app"` (lokale release-bundle van `tauri build`)
   - Deze mogen NOOIT tegelijk met de dev-build draaien, dat geeft verwarrende dubbele vensters.
2. Start de dev-app op de achtergrond met `npm run tauri dev` (run_in_background: true) vanuit de projectroot.
3. Wacht een paar seconden en controleer met `ps aux | grep target/debug/projectradar` dat het proces draait.
4. Meld kort dat de app draait. Open het venster niet zelf via `open_application` — dat opent per ongeluk de geïnstalleerde build in plaats van de dev-build; de dev-app komt vanzelf naar voren zodra hij klaar is met opstarten.
