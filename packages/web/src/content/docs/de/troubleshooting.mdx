---
title: Fehlerbehebung
description: Haeufige Probleme und schnelle Loesungen.
---

Wenn OpenCode Probleme macht, starte mit Logs und lokal gespeicherten Daten auf der Festplatte.

---

## Logs

Logdateien werden hier gespeichert:

- **macOS/Linux**: `~/.local/share/opencode/log/`
- **Windows**: Druecke `WIN+R` und fuege ein: `%USERPROFILE%\.local\share\opencode\log`

Dateinamen enthalten Zeitstempel (z. B. `2025-01-09T123456.log`) und es bleiben die letzten 10 Logs erhalten.

Mit `--log-level` bekommst du detailliertere Diagnoseinfos, z. B. `opencode --log-level DEBUG`.

---

## Speicher

opencode speichert Sitzungs- und App-Daten auf der Festplatte unter:

- **macOS/Linux**: `~/.local/share/opencode/`
- **Windows**: Druecke `WIN+R` und fuege ein: `%USERPROFILE%\.local\share\opencode`

Dieses Verzeichnis enthaelt:

- `auth.json` - Authentifizierungsdaten wie API-Keys und OAuth-Tokens
- `log/` - Anwendungslogs
- `project/` - Projektspezifische Daten wie Sitzungen und Nachrichten
  - In Git-Repositories unter `./<project-slug>/storage/`
  - Ohne Git unter `./global/storage/`

---

## Desktop-App

OpenCode Desktop startet im Hintergrund einen lokalen OpenCode-Server (`opencode-cli`-Sidecar).
Viele Probleme kommen von fehlerhaften Plugins, kaputtem Cache oder falschen Server-Einstellungen.

### Schnellchecks

- App komplett beenden und neu starten
- Bei Fehlerbildschirm **Restart** klicken und Details kopieren
- Nur macOS: `OpenCode`-Menue -> **Reload Webview** (hilft bei leerer/eingefrorener UI)

---

### Plugins deaktivieren

Wenn die Desktop-App beim Start abstuerzt, haengt oder sich seltsam verhaelt, deaktiviere zunaechst Plugins.

#### Globale Konfiguration prüfen

Oeffne deine globale Konfigurationsdatei und suche nach dem `plugin`-Schluessel.

- **macOS/Linux**: `~/.config/opencode/opencode.jsonc` (oder `~/.config/opencode/opencode.json`)
- **macOS/Linux** (aeltere Installationen): `~/.local/share/opencode/opencode.jsonc`
- **Windows**: Druecke `WIN+R` und fuege ein: `%USERPROFILE%\.config\opencode\opencode.jsonc`

Wenn du Plugins konfiguriert hast, deaktiviere sie voruebergehend, indem du den Schluessel entfernst oder auf ein leeres Array setzt:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [],
}
```

#### Plugin-Verzeichnisse prüfen

OpenCode kann auch lokale Plugins von der Festplatte laden. Verschiebe diese voruebergehend (oder benenne den Ordner um) und starte die Desktop-App neu:

- **Globale Plugins**
  - **macOS/Linux**: `~/.config/opencode/plugins/`
  - **Windows**: Druecke `WIN+R` und fuege ein: `%USERPROFILE%\.config\opencode\plugins`
- **Projekt-Plugins** (nur bei projektspezifischer Konfig)
  - `<your-project>/.opencode/plugins/`

Wenn die App wieder funktioniert, aktiviere Plugins nacheinander, um den Verursacher zu finden.

---

### Cache leeren

Wenn das Deaktivieren von Plugins nicht hilft (oder eine Plugin-Installation haengt), leere den Cache, damit OpenCode ihn neu aufbauen kann.

1. Beende OpenCode Desktop komplett.
2. Loesche das Cache-Verzeichnis:

- **macOS**: Finder -> `Cmd+Shift+G` -> einfuegen: `~/.cache/opencode`
- **Linux**: loesche `~/.cache/opencode` (oder fuehre aus: `rm -rf ~/.cache/opencode`)
- **Windows**: Druecke `WIN+R` und fuege ein: `%USERPROFILE%\.cache\opencode`

3. Starte OpenCode Desktop neu.

---

### Server-Verbindungsprobleme beheben

OpenCode Desktop kann entweder einen eigenen lokalen Server starten (Standard) oder sich mit einer konfigurierten Server-URL verbinden.

Wenn du einen **"Connection Failed"**-Dialog siehst (oder die App beim Splash-Screen haengen bleibt), pruefe auf eine benutzerdefinierte Server-URL.

#### Desktop-Standard-Server-URL löschen

Klicke im Startbildschirm auf den Servernamen (mit dem Statuspunkt), um die Serverauswahl zu oeffnen. Klicke im Bereich **Default server** auf **Clear**.

#### `server.port` / `server.hostname` aus Konfiguration entfernen

Wenn deine `opencode.json(c)` einen `server`-Abschnitt enthaelt, entferne ihn voruebergehend und starte die Desktop-App neu.

#### Umgebungsvariablen prüfen

Wenn du `OPENCODE_PORT` in deiner Umgebung gesetzt hast, versucht die Desktop-App diesen Port fuer den lokalen Server zu nutzen.

- Setze `OPENCODE_PORT` zurueck (oder waehle einen freien Port) und starte neu.

---

### Linux: Wayland / X11-Probleme

Unter Linux koennen manche Wayland-Setups leere Fenster oder Compositor-Fehler verursachen.

- Wenn du Wayland nutzt und die App leer ist/abstuerzt, versuche den Start mit `OC_ALLOW_WAYLAND=1`.
- Wenn das es verschlimmert, entferne es und versuche den Start in einer X11-Session.

---

### Windows: WebView2-Laufzeit

Unter Windows benoetigt OpenCode Desktop die Microsoft Edge **WebView2 Runtime**. Wenn die App ein leeres Fenster zeigt oder nicht startet, installiere/aktualisiere WebView2 und versuche es erneut.

---

### Windows: Allgemeine Performance-Probleme

Wenn du langsame Performance, Dateizugriffsprobleme oder Terminal-Probleme unter Windows hast, versuche [WSL (Windows Subsystem for Linux)](/docs/windows-wsl). WSL bietet eine Linux-Umgebung, die nahtloser mit OpenCode-Features funktioniert.

---

### Benachrichtigungen werden nicht angezeigt

OpenCode Desktop zeigt Systembenachrichtigungen nur wenn:

- Benachrichtigungen fuer OpenCode in den OS-Einstellungen aktiviert sind, und
- das App-Fenster nicht fokussiert ist.

---

### Desktop-App-Speicher zurücksetzen (letzter Ausweg)

Wenn die App nicht startet und du Einstellungen nicht in der UI loeschen kannst, setze den gespeicherten Zustand der Desktop-App zurueck.

1. Beende OpenCode Desktop.
2. Finde und loesche diese Dateien (im App-Data-Verzeichnis von OpenCode Desktop):

- `opencode.settings.dat` (desktop default server URL)
- `opencode.global.dat` und `opencode.workspace.*.dat` (UI state like recent servers/projects)

So findest du das Verzeichnis schnell:

- **macOS**: Finder -> `Cmd+Shift+G` -> `~/Library/Application Support` (dann suche nach den Dateinamen oben)
- **Linux**: suche unter `~/.local/share` nach den Dateinamen oben
- **Windows**: Druecke `WIN+R` -> `%APPDATA%` (dann suche nach den Dateinamen oben)

---

## Hilfe bekommen

Wenn du Probleme mit OpenCode hast:

1. **Probleme auf GitHub melden**

   Bugs und Feature-Wuensche meldest du am besten im GitHub-Repository:

   [**github.com/anomalyco/opencode/issues**](https://github.com/anomalyco/opencode/issues)

   Suche vor dem Erstellen nach bestehenden Issues, damit Duplikate vermieden werden.

2. **Unserem Discord beitreten**

   Fuer schnelle Hilfe und Austausch in der Community:

   [**opencode.ai/discord**](https://opencode.ai/discord)

---

## Haeufige Probleme

Hier sind typische Fehlerbilder und wie du sie loest.

---

### OpenCode startet nicht

1. Pruefe die Logs auf Fehlermeldungen
2. Versuche den Start mit `--print-logs`, um Ausgaben im Terminal zu sehen
3. Stelle sicher, dass du die neueste Version hast: `opencode upgrade`

---

### Authentifizierungsprobleme

1. Versuche erneute Authentifizierung mit `/connect` in der TUI
2. Pruefe, ob deine API-Keys gueltig sind
3. Stelle sicher, dass dein Netzwerk Verbindungen zur Provider-API erlaubt

---

### Modell nicht verfügbar

1. Pruefe, ob du dich beim Provider authentifiziert hast
2. Verifiziere, dass der Modellname in deiner Config korrekt ist
3. Manche Modelle erfordern speziellen Zugriff oder Abonnements

Wenn du `ProviderModelNotFoundError` erhaeltst, referenzierst du ein Modell wahrscheinlich falsch.
Modelle sollten so referenziert werden: `<providerId>/<modelId>`

Beispiele:

- `openai/gpt-4.1`
- `openrouter/google/gemini-2.5-flash`
- `opencode/kimi-k2`

Um zu sehen, auf welche Modelle du Zugriff hast, fuehre `opencode models` aus.

---

### ProviderInitError

Wenn du einen ProviderInitError erhaeltst, hast du wahrscheinlich eine ungueltige oder korrupte Konfiguration.

Zur Loesung:

1. Pruefe zuerst, ob dein Provider korrekt eingerichtet ist, gemaess dem [Provider-Guide](/docs/providers)
2. Wenn das Problem besteht, versuche deine gespeicherte Konfiguration zu loeschen:

   ```bash
   rm -rf ~/.local/share/opencode
   ```

   Unter Windows druecke `WIN+R` und loesche: `%USERPROFILE%\.local\share\opencode`

3. Authentifiziere dich erneut beim Provider mit dem `/connect`-Befehl in der TUI.

---

### AI_APICallError und Provider-Paket-Probleme

Wenn du API-Call-Fehler erhaeltst, kann das an veralteten Provider-Paketen liegen. opencode installiert Provider-Pakete (OpenAI, Anthropic, Google, etc.) dynamisch bei Bedarf und cached sie lokal.

Um Provider-Paket-Probleme zu loesen:

1. Leere den Provider-Paket-Cache:

   ```bash
   rm -rf ~/.cache/opencode
   ```

   Unter Windows druecke `WIN+R` und loesche: `%USERPROFILE%\.cache\opencode`

2. Starte opencode neu, um die neuesten Provider-Pakete zu installieren

Dies zwingt opencode, die neuesten Versionen der Provider-Pakete herunterzuladen, was oft Kompatibilitaetsprobleme mit Modellparametern und API-Aenderungen loest.

---

### Copy/Paste funktioniert nicht unter Linux

Linux-Nutzer muessen eines der folgenden Clipboard-Utilities installiert haben, damit Copy/Paste funktioniert:

**Fuer X11-Systeme:**

```bash
apt install -y xclip
# or
apt install -y xsel
```

**Fuer Wayland-Systeme:**

```bash
apt install -y wl-clipboard
```

**Fuer Headless-Umgebungen:**

```bash
apt install -y xvfb
# and run:
Xvfb :99 -screen 0 1024x768x24 > /dev/null 2>&1 &
export DISPLAY=:99.0
```

opencode erkennt, ob du Wayland nutzt und bevorzugt `wl-clipboard`, sonst versucht es `xclip` und `xsel` (in dieser Reihenfolge).
