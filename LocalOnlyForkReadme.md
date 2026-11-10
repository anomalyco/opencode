# opencode lokal – was dieser Fork anders macht

Dieser Fork ist opencode, das ohne Internet läuft. Er ist für den Einsatz in einem Netz ohne Internetzugang
gedacht: Modelle laufen auf einem eigenen Server (Ollama, LM Studio, vLLM, llama.cpp, …), und opencode baut keine
Verbindung zu opencode.ai, GitHub, npm oder Cloud-Anbietern auf.

Für die Bedienung selbst gilt die normale [README](README.md) von opencode. Hier steht nur, was anders ist und was
man für den Betrieb wissen muss.

> Technische Details zu jeder Änderung (für Merges mit Upstream): [`FORK-CHANGES.md`](local-only/FORK-CHANGES.md)

---

## Was im Programm geändert ist

Diese Punkte sind fest eingebaut und lassen sich nicht über die Config zurückdrehen.

| Bereich | Upstream-Verhalten | In diesem Fork |
| --- | --- | --- |
| **Modellkatalog** | lädt die Modellliste von `models.opencode.ai` | nutzt den mitgelieferten Katalog. Ein eigener Katalog geht per `OPENCODE_MODELS_PATH` (Datei) oder `OPENCODE_MODELS_URL` (lokaler Mirror) |
| **ripgrep** (Dateisuche) | lädt `rg` bei Bedarf von GitHub herunter | lädt nichts. `rg` muss installiert sein, sonst gibt es eine klare Fehlermeldung |
| **Syntax-Hervorhebung** im Terminal | lädt Grammatiken von GitHub | Grammatiken sind mitgeliefert. Sprachen, die nicht dabei sind, erscheinen ohne Farben |
| **Websuche** | Modell darf im Web suchen (Exa sogar ohne API-Key) | **immer aus**. Suchanfragen könnten Code aus der Session nach außen tragen. Die Sperre ist einkompiliert und hat Vorrang vor jeder Config |

---

## Was über die Config abgeschaltet wird

Die Datei [`opencode.jsonc`](local-only/opencode.jsonc) ist eine fertige Vorlage. Sie gehört nach
`~/.config/opencode/opencode.jsonc` (Windows: `%USERPROFILE%\.config\opencode\opencode.jsonc`).

Sie schaltet ab bzw. legt fest:

- **Updates**: kein Update-Check (`"update": "disable"`)
- **Teilen**: keine Session-Links über opencode.ai (`"share": "disabled"`)
- **Formatter**: kein automatisches Nachladen von prettier & Co. aus npm (`"formatter": false`)
- **webfetch**: Abrufe ins Internet verboten, nur `localhost`/`127.0.0.1` erlaubt. Bei Bedarf lässt sich
  webfetch mit Rückfrage vor jedem Abruf freischalten (auskommentierte Zeilen in der Vorlage).
- **Cloud-Provider und Konten** (OpenAI, Anthropic, Copilot, opencode Console, …): gesperrt
- **Lokale Provider**: Ollama, LM Studio und ein Firmen-Server (`"firma"`) sind freigegeben
- **Standardmodell**: fest vorgegeben, damit opencode nicht zufällig ein Modell ohne laufenden Server wählt

Diese Einstellungen kann jeder Anwender in seiner Config ändern. Fest eingebaut ist nur, was oben unter „Was im
Programm geändert ist“ steht.

---

## Einrichtung

### 1. Config anpassen

In `opencode.jsonc`:

1. Beim Provider `"firma"` die Adresse des eigenen LLM-Servers eintragen (`"baseURL"`) und unter `"models"` die
   Modell-ID so, wie der Server sie unter `<baseURL>/models` meldet.
2. `"model"` auf `"firma/<modell-id>"` setzen.
3. Nicht genutzte lokale Provider (Ollama, LM Studio) unter `"policies"` und `"providers"` entfernen.
4. Verlangt der Server einen API-Key, die Umgebungsvariable `FIRMA_API_KEY` setzen.

Hinweis für Denk-Modelle (z. B. Qwen3): Liefert das Modell nach dem Nachdenken keine Tool-Aufrufe, hilft der
`reasoning_effort`-Hinweis in der Vorlage.

### 2. Umgebungsvariablen setzen

**macOS / Linux:** [`offline.env`](local-only/offline.env) einbinden, z. B. in `~/.zshrc`:

```sh
set -a; source /pfad/zu/local-only/offline.env; set +a
```

**Windows:** [`opencode-offline.cmd`](local-only/opencode-offline.cmd) neben `opencode.exe` und `rg.exe` legen und opencode
darüber starten. Das Skript setzt dieselben Variablen und findet `rg.exe` im selben Ordner.

### 3. ripgrep bereitstellen

- macOS: `brew install ripgrep` (vor dem Umzug ins Firmennetz) oder `rg` in den `PATH` legen
- Linux: Paket `ripgrep`
- Windows: `rg.exe` neben `opencode.exe`

---

## Prüfen, ob alles offline bleibt

- opencode starten: Es muss ohne Internet hochfahren, die Modellliste anzeigen und mit dem lokalen Server arbeiten.
- Ausgehende Verbindungen beobachten, z. B. `lsof -i -P | grep opencode` oder mit Little Snitch / LuLu (macOS).
  Erwartet sind nur Verbindungen zu `127.0.0.1` bzw. zum eigenen LLM-Server.

---

## Was der Fork nicht verhindert

Die Sperren schützen davor, dass **das Modell** von sich aus Daten nach außen schickt. Gegen einen Anwender, der
das bewusst einrichtet, schützen sie nicht:

- **MCP-Server** lassen sich weiterhin in der Config eintragen, auch solche mit Internet-Adresse.
- Das **Shell-Tool** kann Befehle wie `curl` ausführen (je nach Rechte-Einstellung mit Rückfrage).
- **Plugins** sind Code mit vollen Rechten.

Verlässlich abschotten lässt sich das nur über das Netz (Firewall, Proxy bzw. ein Netz ohne Internetzugang).

---

## Fork aktualisieren

Wenn eine neue opencode-Version übernommen wird, führt man danach im Repo-Root `local-only/check-fork.sh` aus.
Das Skript meldet, ob eine der Fork-Änderungen beim Merge verloren gegangen ist, und listet Internet-Adressen im
Code auf, die neu dazugekommen sein könnten. Das genaue Vorgehen steht in [`FORK-CHANGES.md`](local-only/FORK-CHANGES.md).
