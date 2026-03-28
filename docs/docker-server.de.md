# OpenCode Server Docker Dokumentation

Dieser Leitfaden behandelt das Ausführen von OpenCode im Servermodus in Docker-Containern.

## Einführung

OpenCode Server ist ein headless Deployment von OpenCode, das als Hintergrunddienst läuft und über die HTTP-API zugänglich ist. Das Docker-Image bietet eine vollständige Laufzeitumgebung mit allen erforderlichen vorinstallierten Tools, ideal für:

- Remote-Entwicklungsumgebungen
- CI/CD-Integration
- Gemeinsam genutzte Coding-Instanzen für Teams
- Ausführen von OpenCode auf Servern ohne GUI

## Schnellstart

Führen Sie OpenCode Server mit einem sicheren Passwort aus:

```bash
docker run -d \
  --name opencode-server \
  -p 3000:3000 \
  -e OPENCODE_SERVER_PASSWORD=your_secure_password \
  -v opencode_workspace:/workspace \
  ghcr.io/anomalyco/opencode/server:debian
```

Greifen Sie auf den Server unter `http://localhost:3000` zu.

## Image-Varianten

Zwei Basis-Image-Varianten sind verfügbar:

| Variante | Basis-Image        | Größe  | Anwendungsfall                        |
| -------- | ------------------ | ------ | ------------------------------------- |
| `debian` | Debian Trixie Slim | ~500MB | Für die meisten Benutzer empfohlen    |
| `alpine` | Alpine Edge        | ~200MB | Minimaler Footprint, schnellerer Pull |

### Bestimmte Varianten herunterladen

```bash
# Debian (empfohlen)
docker pull ghcr.io/anomalyco/opencode/server:debian

# Alpine (minimal)
docker pull ghcr.io/anomalyco/opencode/server:alpine
```

## Umgebungsvariablen

| Variable                   | Standard                      | Beschreibung                                                |
| -------------------------- | ----------------------------- | ----------------------------------------------------------- |
| `OPENCODE_SERVER_PASSWORD` | (keine)                       | **Erforderlich.** Passwort für HTTP Basic-Authentifizierung |
| `OPENCODE_SERVER_USERNAME` | `opencode`                    | Benutzername für HTTP Basic-Authentifizierung               |
| `XDG_CONFIG_HOME`          | `/home/opencode/.config`      | Konfigurationsverzeichnis                                   |
| `XDG_CACHE_HOME`           | `/home/opencode/.cache`       | Cache-Verzeichnis                                           |
| `XDG_DATA_HOME`            | `/home/opencode/.local/share` | Datenverzeichnis                                            |

### Server-Optionen (CLI-Flags)

Der Server akzeptiert diese zusätzlichen Optionen beim Überschreiben des Standardbefehls:

```bash
docker run ... ghcr.io/anomalyco/opencode/server:debian \
  opencode serve --hostname=0.0.0.0 --port=3000 --cors=https://example.com
```

| Flag            | Standard         | Beschreibung                        |
| --------------- | ---------------- | ----------------------------------- |
| `--port`        | `0` (zufällig)   | Port zum Lauschen                   |
| `--hostname`    | `127.0.0.1`      | Hostname zum Binden                 |
| `--mdns`        | `false`          | mDNS-Diensterkennung aktivieren     |
| `--mdns-domain` | `opencode.local` | Benutzerdefinierter mDNS-Domainname |
| `--cors`        | `[]`             | Zusätzliche CORS-erlaubte Domains   |

## Volume-Einbindungen

Binden Sie diese Volumes ein, um Daten zu persistieren und Ressourcen zu teilen:

### Arbeitsbereich (Erforderlich)

```bash
-v /path/to/workspace:/workspace
```

Hier arbeitet OpenCode an Ihren Projektdateien. Binden Sie hier Ihr Code-Repository ein.

### SSH-Schlüssel

```bash
-v ~/.ssh:/home/opencode/.ssh:ro
```

Schreibgeschützter Zugriff auf SSH-Schlüssel zum Klonen privater Repositories.

### Git-Konfiguration

```bash
-v ~/.gitconfig:/home/opencode/.gitconfig:ro
```

Git-Benutzeridentität vom Host erben.

### OpenCode-Konfiguration

```bash
-v ~/.config/opencode:/home/opencode/.config/opencode
```

OpenCode-Einstellungen zwischen Container-Neustarts beibehalten.

### Cache

```bash
-v opencode_cache:/home/opencode/.cache
```

Cache für npm-Pakete, Language-Server und andere heruntergeladene Tools.

## Ports

| Port   | Protokoll | Beschreibung                |
| ------ | --------- | --------------------------- |
| `3000` | HTTP      | Haupt-Server-API (Standard) |

Der Port kann über Dockers `-p`-Flag neu zugeordnet werden:

```bash
-p 8080:3000  # Auf Server unter http://localhost:8080 zugreifen
```

## Benutzer und Berechtigungen

Der Container läuft aus Sicherheitsgründen als Nicht-Root-Benutzer (`opencode`, UID 1000). Dieser Benutzer hat `sudo`-Zugriff ohne Passwort für administrative Aufgaben:

```bash
# Befehle als opencode-Benutzer ausführen
docker exec -it opencode-server sudo -u opencode <command>

# Shell als opencode-Benutzer erhalten
docker exec -it opencode-server sudo -u opencode /bin/bash
```

Wenn Sie Root-Zugriff benötigen:

```bash
docker exec -it opencode-server /bin/bash
```

## Installierte Tools

Das Image enthält diese Tools standardmäßig:

| Tool              | Beschreibung                                  |
| ----------------- | --------------------------------------------- |
| `opencode`        | OpenCode CLI                                  |
| `bun`             | JavaScript-Laufzeit und Paketmanager          |
| `bunx`            | Buns Equivalent zu npx (npm-Pakete ausführen) |
| `uv`              | Python-Paketmanager                           |
| `git`             | Versionskontrolle                             |
| `git-lfs`         | Large File Storage Erweiterung für Git        |
| `build-essential` | GCC, make und Build-Bibliotheken              |
| `curl`            | HTTP-Client                                   |
| `wget`            | Datei-Download-Tool                           |
| `openssh-client`  | SSH-Client und Key-Tools                      |
| `xz-utils`        | Komprimierungs-Tools                          |

### Bun verwenden

```bash
# Ein Node.js-Paket ausführen
docker exec -it opencode-server bunx create-next-app

# Abhängigkeiten installieren
docker exec -it opencode-server bun install
```

### uv verwenden

```bash
# Ein Python-Paket installieren
docker exec -it opencode-server uv pip install pandas

# Ein Python-Skript ausführen
docker exec -it opencode-server uv run script.py
```

### Git verwenden

```bash
# Ein Repository in den Arbeitsbereich klonen
docker exec -it opencode-server git clone https://github.com/user/repo.git /workspace/repo
```

## Health Check

Der Container enthält einen integrierten Health-Check, der überprüft, ob der Server antwortet:

```bash
# Container-Health prüfen
docker inspect --format='{{.State.Health.Status}}' opencode-server
```

Der Health-Endpunkt gibt HTTP 200 zurück, wenn der Server gesund ist:

```bash
# Manueller Health-Check
curl -f http://localhost:3000/health
```

Health-Check-Konfiguration:

- Intervall: 30 Sekunden
- Timeout: 10 Sekunden
- Startperiode: 10 Sekunden
- Wiederholungen: 3

## Docker Compose Beispiel

Erstellen Sie eine `docker-compose.yml`-Datei:

```yaml
services:
  opencode:
    image: ghcr.io/anomalyco/opencode/server:debian
    container_name: opencode-server
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - OPENCODE_SERVER_PASSWORD=your_secure_password
      - OPENCODE_SERVER_USERNAME=opencode
    volumes:
      - ./workspace:/workspace
      - opencode_config:/home/opencode/.config
      - opencode_cache:/home/opencode/.cache
      - ~/.ssh:/home/opencode/.ssh:ro
      - ~/.gitconfig:/home/opencode/.gitconfig:ro
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

volumes:
  opencode_config:
  opencode_cache:
```

Starten Sie den Stack:

```bash
docker-compose up -d
```

## Aus dem Quellcode bauen

So bauen Sie das Server-Image aus dem Quellcode:

### Repository klonen

```bash
git clone https://github.com/anomalyco/opencode.git
cd opencode
```

### Debian-Variante bauen

```bash
docker build \
  -f packages/containers/server/docker/Dockerfile.debian \
  -t opencode-server:local \
  .
```

### Alpine-Variante bauen

```bash
docker build \
  -f packages/containers/server/docker/Dockerfile.alpine \
  -t opencode-server:alpine-local \
  .
```

### Ihren lokalen Build ausführen

```bash
docker run -d \
  -p 3000:3000 \
  -e OPENCODE_SERVER_PASSWORD=dev_password \
  -v $(pwd)/workspace:/workspace \
  opencode-server:local
```

## Fehlerbehebung

### Server startet nicht

Überprüfen Sie die Logs:

```bash
docker logs opencode-server
```

Häufige Probleme:

- Fehlende `OPENCODE_SERVER_PASSWORD` - der Server verweigert das Starten ohne Authentifizierung
- Port bereits belegt - ändern Sie die Host-Port-Zuordnung

### Authentifizierung fehlgeschlagen

Stellen Sie sicher, dass das Passwort genau übereinstimmt. Der Server verwendet HTTP Basic Auth:

```bash
# Authentifizierung testen
curl -u opencode:your_password http://localhost:3000/health
```

### Arbeitsbereich-Berechtigungsfehler

Stellen Sie sicher, dass das eingebundene Verzeichnis für UID 1000 beschreibbar ist:

```bash
# Eigentum ändern
sudo chown -R 1000:1000 /path/to/workspace
```

### Langsamer Start

Der erste Download lädt Language-Server und Tools herunter. Überprüfen Sie den Fortschritt:

```bash
docker logs -f opencode-server
```

### Container kann das Internet nicht erreichen

Überprüfen Sie die DNS-Konfiguration:

```bash
docker exec opencode-server ping -c 3 8.8.8.8
docker exec opencode-server cat /etc/resolv.conf
```

### Health-Check schlägt fehl

Überprüfen Sie, ob der Server tatsächlich läuft:

```bash
docker exec opencode-server curl -f http://localhost:3000/health
```

### SSH-Schlüssel funktioniert nicht

Stellen Sie die richtigen Schlüsselberechtigungen im Container sicher:

```bash
docker exec opencode-server sudo chmod 600 /home/opencode/.ssh/id_rsa
docker exec opencode-server sudo chmod 644 /home/opencode/.ssh/id_rsa.pub
```
