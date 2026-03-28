# OpenCode Server Docker Dokumentasjon

Denne guiden dekker kjøring av OpenCode i servermodus inne i Docker-containere.

## Introduksjon

OpenCode Server er en hodeløs distribusjon av OpenCode som kjører som en bakgrunnstjeneste, tilgjengelig via HTTP API. Docker-bildet gir et komplett kjøremiljø med alle nødvendige verktøy forhåndsinstallert, noe som gjør det ideelt for:

- Eksterne utviklingsmiljøer
- CI/CD-integrasjon
- Dele kodende instanser for team
- Kjøre OpenCode på servere uten GUI

## Hurtigstart

Kjør OpenCode Server med et sikkert passord:

```bash
docker run -d \
  --name opencode-server \
  -p 3000:3000 \
  -e OPENCODE_SERVER_PASSWORD=your_secure_password \
  -v opencode_workspace:/workspace \
  ghcr.io/anomalyco/opencode/server:debian
```

Få tilgang til serveren på `http://localhost:3000`.

## Bildevarianter

To basebildevarianter er tilgjengelige:

| Variant  | Bildebase          | Størrelse | Brukstilfelle                          |
| -------- | ------------------ | --------- | -------------------------------------- |
| `debian` | Debian Trixie Slim | ~500MB    | Anbefalt for de fleste brukere         |
| `alpine` | Alpine Edge        | ~200MB    | Minimal fotavtrykk, raskere nedlasting |

### Hente spesifikke varianter

```bash
# Debian (anbefalt)
docker pull ghcr.io/anomalyco/opencode/server:debian

# Alpine (minimal)
docker pull ghcr.io/anomalyco/opencode/server:alpine
```

## Miljøvariabler

| Variabel                   | Standard                      | Beskrivelse                                       |
| -------------------------- | ----------------------------- | ------------------------------------------------- |
| `OPENCODE_SERVER_PASSWORD` | (ingen)                       | **Påkrevd.** Passord for HTTP Basic autentisering |
| `OPENCODE_SERVER_USERNAME` | `opencode`                    | Brukernavn for HTTP Basic autentisering           |
| `XDG_CONFIG_HOME`          | `/home/opencode/.config`      | Konfigurasjonskatalog                             |
| `XDG_CACHE_HOME`           | `/home/opencode/.cache`       | Cache-katalog                                     |
| `XDG_DATA_HOME`            | `/home/opencode/.local/share` | Datakatalog                                       |

### Serveralternativer (CLI-flagg)

Serveren godtar disse tilleggsalternativene når standardkommandoen overskrives:

```bash
docker run ... ghcr.io/anomalyco/opencode/server:debian \
  opencode serve --hostname=0.0.0.0 --port=3000 --cors=https://example.com
```

| Flagg           | Standard         | Beskrivelse                     |
| --------------- | ---------------- | ------------------------------- |
| `--port`        | `0` (tilfeldig)  | Port å lytte på                 |
| `--hostname`    | `127.0.0.1`      | Vertnavn å binde til            |
| `--mdns`        | `false`          | Aktiver mDNS-tjenesteoppdagelse |
| `--mdns-domain` | `opencode.local` | Egendefinert mDNS-domenenavn    |
| `--cors`        | `[]`             | Ekstra CORS-tillatte domener    |

## Volumkjøring

Kjør disse volumene for å vedvare data og dele ressurser:

### Arbeidsområde (Påkrevd)

```bash
-v /path/to/workspace:/workspace
```

Dette er der OpenCode opererer på prosjektfilene dine. Kjør kodearkivet ditt her.

### SSH-nøkler

```bash
-v ~/.ssh:/home/opencode/.ssh:ro
```

Skrivebeskyttet tilgang til SSH-nøkler for å klone private arkiver.

### Git-konfigurasjon

```bash
-v ~/.gitconfig:/home/opencode/.gitconfig:ro
```

Arv Git-brukeridentitet fra verten.

### OpenCode-konfigurasjon

```bash
-v ~/.config/opencode:/home/opencode/.config/opencode
```

Vedvar OpenCode-innstillinger mellom containeromstarter.

### Cache

```bash
-v opencode_cache:/home/opencode/.cache
```

Bufret npm-pakker, språkservere og andre nedlastede verktøy.

## Porter

| Port   | Protokoll | Beskrivelse                |
| ------ | --------- | -------------------------- |
| `3000` | HTTP      | Hovedserver API (standard) |

Porten kan omkartlegges via Docker sin `-p` flagg:

```bash
-p 8080:3000  # Få tilgang til server på http://localhost:8080
```

## Bruker og Tillatelser

Containeren kjører som en ikke-root bruker (`opencode`, UID 1000) av sikkerhetsgrunner. Denne brukeren har `sudo`-tilgang uten passord for administrative oppgaver:

```bash
# Kjør kommandoer som opencode-bruker
docker exec -it opencode-server sudo -u opencode <command>

# Få shell som opencode-bruker
docker exec -it opencode-server sudo -u opencode /bin/bash
```

Hvis du trenger root-tilgang:

```bash
docker exec -it opencode-server /bin/bash
```

## Installerte Verktøy

Bildet inkluderer disse verktøyene:

| Verktøy           | Beskrivelse                                  |
| ----------------- | -------------------------------------------- |
| `opencode`        | OpenCode CLI                                 |
| `bun`             | JavaScript runtime og pakkebehandler         |
| `bunx`            | Bun sin equivalent til npx (kjør npm-pakker) |
| `uv`              | Python pakkebehandler                        |
| `git`             | Versjonskontroll                             |
| `git-lfs`         | Large file storage-utvidelse for Git         |
| `build-essential` | GCC, make og byggebiblioteker                |
| `curl`            | HTTP-klient                                  |
| `wget`            | Filnedlastingsverktøy                        |
| `openssh-client`  | SSH-klient og nøkkelverktøy                  |
| `xz-utils`        | Komprimeringsverktøy                         |

### Bruke bun

```bash
# Kjør en Node.js-pakke
docker exec -it opencode-server bunx create-next-app

# Installer avhengigheter
docker exec -it opencode-server bun install
```

### Bruke uv

```bash
# Installer en Python-pakke
docker exec -it opencode-server uv pip install pandas

# Kjør et Python-skript
docker exec -it opencode-server uv run script.py
```

### Bruke git

```bash
# Klon et arkiv til arbeidsområdet
docker exec -it opencode-server git clone https://github.com/user/repo.git /workspace/repo
```

## Helsesjekk

Containeren inkluderer en innebygd helsesjekk som verifiserer at serveren svarer:

```bash
# Sjekk containerhelse
docker inspect --format='{{.State.Health.Status}}' opencode-server
```

Helseslutpunktet returnerer HTTP 200 når det er sunt:

```bash
# Manuell helsesjekk
curl -f http://localhost:3000/health
```

Helsesjekk-konfigurasjon:

- Intervall: 30 sekunder
- Tidsavbrudd: 10 sekunder
- Startperiode: 10 sekunder
- Forsøk: 3

## Docker Compose Eksempel

Opprett en `docker-compose.yml` fil:

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

Start stacken:

```bash
docker-compose up -d
```

## Bygge fra Kilde

For å bygge serverbildet fra kilde:

### Klon arkivet

```bash
git clone https://github.com/anomalyco/opencode.git
cd opencode
```

### Bygg Debian-varianten

```bash
docker build \
  -f packages/containers/server/docker/Dockerfile.debian \
  -t opencode-server:local \
  .
```

### Bygg Alpine-varianten

```bash
docker build \
  -f packages/containers/server/docker/Dockerfile.alpine \
  -t opencode-server:alpine-local \
  .
```

### Kjør din lokale bygging

```bash
docker run -d \
  -p 3000:3000 \
  -e OPENCODE_SERVER_PASSWORD=dev_password \
  -v $(pwd)/workspace:/workspace \
  opencode-server:local
```

## Feilsøking

### Serveren starter ikke

Sjekk loggene:

```bash
docker logs opencode-server
```

Vanlige problemer:

- Mangler `OPENCODE_SERVER_PASSWORD` - serveren nekter å starte uten autentisering
- Port allerede i bruk - endre vertsport-kartleggingen

### Autentisering feiler

Sørg for at passordet matcher nøyaktig. Serveren bruker HTTP Basic Auth:

```bash
# Test autentisering
curl -u opencode:your_password http://localhost:3000/health
```

### Arbeidsområdet tillatelsesfeil

Sørg for at den monterte katalogen er skrivbar av UID 1000:

```bash
# Fiks eierskap
sudo chown -R 1000:1000 /path/to/workspace
```

### Treg oppstart

Første kjøring laster ned språkservere og verktøy. Sjekk fremdriften:

```bash
docker logs -f opencode-server
```

### Container kan ikke nå internett

Sjekk DNS-konfigurasjonen:

```bash
docker exec opencode-server ping -c 3 8.8.8.8
docker exec opencode-server cat /etc/resolv.conf
```

### Helsesjekk feiler

Verifiser at serveren faktisk kjører:

```bash
docker exec opencode-server curl -f http://localhost:3000/health
```

### SSH-nøkkel fungerer ikke

Sørg for riktige nøkkeltillatelser inne i containeren:

```bash
docker exec opencode-server sudo chmod 600 /home/opencode/.ssh/id_rsa
docker exec opencode-server sudo chmod 644 /home/opencode/.ssh/id_rsa.pub
```
