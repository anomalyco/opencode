# OpenCode Server Docker Dokumentation

Denne vejledning dækker kørsel af OpenCode i servertilstand inde i Docker-containere.

## Introduktion

OpenCode Server er en hovedløs installation af OpenCode, der kører som en baggrundstjeneste, tilgængelig via HTTP API. Docker-image'et giver en komplet kørtid med alle nødvendige værktøjer forudinstalleret, hvilket gør det ideelt til:

- Fjernudviklingsmiljøer
- CI/CD-integration
- Delt kodningsinstanser til teams
- Kørsel af OpenCode på servere uden grafisk brugergrænseflade

## Hurtig start

Kør OpenCode Server med en sikker adgangskode:

```bash
docker run -d \
  --name opencode-server \
  -p 3000:3000 \
  -e OPENCODE_SERVER_PASSWORD=your_secure_password \
  -v opencode_workspace:/workspace \
  ghcr.io/anomalyco/opencode/server:debian
```

Adgang til serveren på `http://localhost:3000`.

## Image-varianter

To basisimage-varianter er tilgængelige:

| Variant  | Basisimage         | Størrelse | Anvendelse                             |
| -------- | ------------------ | --------- | -------------------------------------- |
| `debian` | Debian Trixie Slim | ~500MB    | Anbefales til de fleste brugere        |
| `alpine` | Alpine Edge        | ~200MB    | Minimalt fodaftryk, hurtigere hentning |

### Hentning af specifikke varianter

```bash
# Debian (anbefalet)
docker pull ghcr.io/anomalyco/opencode/server:debian

# Alpine (minimal)
docker pull ghcr.io/anomalyco/opencode/server:alpine
```

## Miljøvariabler

| Variabel                   | Standard                      | Beskrivelse                                          |
| -------------------------- | ----------------------------- | ---------------------------------------------------- |
| `OPENCODE_SERVER_PASSWORD` | (ingen)                       | **Påkrævet.** Adgangskode til HTTP Basic-godkendelse |
| `OPENCODE_SERVER_USERNAME` | `opencode`                    | Brugernavn til HTTP Basic-godkendelse                |
| `XDG_CONFIG_HOME`          | `/home/opencode/.config`      | Konfigurationsmappe                                  |
| `XDG_CACHE_HOME`           | `/home/opencode/.cache`       | Cache-mappe                                          |
| `XDG_DATA_HOME`            | `/home/opencode/.local/share` | Datamappe                                            |

### Serverindstillinger (CLI-flags)

Serveren accepterer disse ekstra indstillinger, når standardkommandoen overskrives:

```bash
docker run ... ghcr.io/anomalyco/opencode/server:debian \
  opencode serve --hostname=0.0.0.0 --port=3000 --cors=https://example.com
```

| Flag            | Standard         | Beskrivelse                      |
| --------------- | ---------------- | -------------------------------- |
| `--port`        | `0` (tilfældig)  | Port at lytte på                 |
| `--hostname`    | `127.0.0.1`      | Værtsnavn at binde til           |
| `--mdns`        | `false`          | Aktiver mDNS-tjenesteopdagelse   |
| `--mdns-domain` | `opencode.local` | Brugerdefineret mDNS-domænenavn  |
| `--cors`        | `[]`             | Yderligere CORS-tilladte domæner |

## Volumenmontering

Monter disse volumener for at bevare data og dele ressourcer:

### Arbejdsområde (Påkrævet)

```bash
-v /path/to/workspace:/workspace
```

Her opererer OpenCode på dine projektfiler. Montér dit kode-lager her.

### SSH-nøgler

```bash
-v ~/.ssh:/home/opencode/.ssh:ro
```

Læseadgang til SSH-nøgler til kloning af private repositories.

### Git-konfiguration

```bash
-v ~/.gitconfig:/home/opencode/.gitconfig:ro
```

Arv Gitbrugeridentitet fra værten.

### OpenCode-konfiguration

```bash
-v ~/.config/opencode:/home/opencode/.config/opencode
```

Bevar OpenCode-indstillinger mellem container-genstartere.

### Cache

```bash
-v opencode_cache:/home/opencode/.cache
```

Cache npm-pakker, sprogservere og andre downloadede værktøjer.

## Porte

| Port   | Protokol | Beskrivelse                |
| ------ | -------- | -------------------------- |
| `3000` | HTTP     | Hovedserver-API (standard) |

Porten kan ændres via Dockers `-p`-flag:

```bash
-p 8080:3000  # Adgang til server på http://localhost:8080
```

## Bruger og tilladelser

Containeren kører som en ikke-root bruger (`opencode`, UID 1000) af sikkerhedsmæssige årsager. Denne bruger har `sudo`-adgang uden adgangskode til administrative opgaver:

```bash
# Udfør kommandoer som opencode-bruger
docker exec -it opencode-server sudo -u opencode <command>

# Få shell som opencode-bruger
docker exec -it opencode-server sudo -u opencode /bin/bash
```

Hvis du har brug for root-adgang:

```bash
docker exec -it opencode-server /bin/bash
```

## Installerede værktøjer

Image'et inkluderer disse værktøjer ud af boksen:

| Værktøj           | Beskrivelse                              |
| ----------------- | ---------------------------------------- |
| `opencode`        | OpenCode CLI                             |
| `bun`             | JavaScript-kørtid og pakkehåndtering     |
| `bunx`            | Buns equivalent til npx (kør npm-pakker) |
| `uv`              | Python-pakkehåndtering                   |
| `git`             | Versionskontrol                          |
| `git-lfs`         | Stor fil-lagringsudvidelse til Git       |
| `build-essential` | GCC, make og build-biblioteker           |
| `curl`            | HTTP-klient                              |
| `wget`            | Fil-download-værktøj                     |
| `openssh-client`  | SSH-klient og nøgleværktøjer             |
| `xz-utils`        | Komprimeringsværktøjer                   |

### Brug af bun

```bash
# Kør en Node.js-pakke
docker exec -it opencode-server bunx create-next-app

# Installer afhængigheder
docker exec -it opencode-server bun install
```

### Brug af uv

```bash
# Installer en Python-pakke
docker exec -it opencode-server uv pip install pandas

# Kør et Python-script
docker exec -it opencode-server uv run script.py
```

### Brug af git

```bash
# Klon et repository til arbejdsområdet
docker exec -it opencode-server git clone https://github.com/user/repo.git /workspace/repo
```

## Sundhedskontrol

Containeren inkluderer en indbygget sundhedskontrol, der verificerer, at serveren svarer:

```bash
# Kontroller containerens sundhed
docker inspect --format='{{.State.Health.Status}}' opencode-server
```

Sundhedsendepunktet returnerer HTTP 200, når det er sundt:

```bash
# Manuel sundhedskontrol
curl -f http://localhost:3000/health
```

Sundhedskontrolkonfiguration:

- Interval: 30 sekunder
- Timeout: 10 sekunder
- Startperiode: 10 sekunder
- Forsøg: 3

## Docker Compose-eksempel

Opret en `docker-compose.yml`-fil:

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

## Build fra kilde

Sådan bygger du serverimage'et fra kilde:

### Klon repository'et

```bash
git clone https://github.com/anomalyco/opencode.git
cd opencode
```

### Byg Debian-variant

```bash
docker build \
  -f packages/containers/server/docker/Dockerfile.debian \
  -t opencode-server:local \
  .
```

### Byg Alpine-variant

```bash
docker build \
  -f packages/containers/server/docker/Dockerfile.alpine \
  -t opencode-server:alpine-local \
  .
```

### Kør din lokale build

```bash
docker run -d \
  -p 3000:3000 \
  -e OPENCODE_SERVER_PASSWORD=dev_password \
  -v $(pwd)/workspace:/workspace \
  opencode-server:local
```

## Fejlfinding

### Server starter ikke

Tjek loggene:

```bash
docker logs opencode-server
```

Almindelige problemer:

- Mangler `OPENCODE_SERVER_PASSWORD` - serveren nægter at starte uden godkendelse
- Port allerede i brug - ændr værtsport-tilknytningen

### Godkendelse fejler

Sørg for, at adgangskoden matcher nøjagtigt. Serveren bruger HTTP Basic Auth:

```bash
# Test godkendelse
curl -u opencode:your_password http://localhost:3000/health
```

### Arbejdsområde-tilladelsesfejl

Sørg for, at den monterede mappe er skrivbar af UID 1000:

```bash
# Ret ejerskab
sudo chown -R 1000:1000 /path/to/workspace
```

### Langsom start

Den første kørsel downloader sprogservere og værktøjer. Tjek fremskridt:

```bash
docker logs -f opencode-server
```

### Container kan ikke nå internettet

Tjek DNS-konfiguration:

```bash
docker exec opencode-server ping -c 3 8.8.8.8
docker exec opencode-server cat /etc/resolv.conf
```

### Sundhedskontrol fejler

Verificer, at serveren faktisk kører:

```bash
docker exec opencode-server curl -f http://localhost:3000/health
```

### SSH-nøgle fungerer ikke

Sørg for korrekte nøgletilladelser inde i containeren:

```bash
docker exec opencode-server sudo chmod 600 /home/opencode/.ssh/id_rsa
docker exec opencode-server sudo chmod 644 /home/opencode/.ssh/id_rsa.pub
```
