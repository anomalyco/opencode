# Documentazione Docker di OpenCode Server

Questa guida illustra l'esecuzione di OpenCode in modalità server all'interno di contenitori Docker.

## Introduzione

OpenCode Server è una distribuzione headless di OpenCode che viene eseguita come servizio in background, accessibile tramite API HTTP. L'immagine Docker fornisce un ambiente di runtime completo con tutti gli strumenti necessari preinstallati, ideale per:

- Ambienti di sviluppo remoto
- Integrazione CI/CD
- Istanze di codifica condivise per team
- Esecuzione di OpenCode su server senza interfaccia grafica

## Avvio Rapido

Esegui OpenCode Server con una password sicura:

```bash
docker run -d \
  --name opencode-server \
  -p 3000:3000 \
  -e OPENCODE_SERVER_PASSWORD=your_secure_password \
  -v opencode_workspace:/workspace \
  ghcr.io/anomalyco/opencode/server:debian
```

Accedi al server all'indirizzo `http://localhost:3000`.

## Varianti dell'Immagine

Sono disponibili due varianti di immagine base:

| Variante | Immagine Base      | Dimensione | Caso d'Uso                       |
| -------- | ------------------ | ---------- | -------------------------------- |
| `debian` | Debian Trixie Slim | ~500MB     | Consigliato per la maggior parte |
| `alpine` | Alpine Edge        | ~200MB     | Impronta minima, pull più veloce |

### Scaricare Varianti Specifiche

```bash
# Debian (consigliato)
docker pull ghcr.io/anomalyco/opencode/server:debian

# Alpine (minimale)
docker pull ghcr.io/anomalyco/opencode/server:alpine
```

## Variabili di Ambiente

| Variabile                  | Predefinita                   | Descrizione                                             |
| -------------------------- | ----------------------------- | ------------------------------------------------------- |
| `OPENCODE_SERVER_PASSWORD` | (nessuna)                     | **Richiesta.** Password per l'autenticazione HTTP Basic |
| `OPENCODE_SERVER_USERNAME` | `opencode`                    | Nome utente per l'autenticazione HTTP Basic             |
| `XDG_CONFIG_HOME`          | `/home/opencode/.config`      | Directory di configurazione                             |
| `XDG_CACHE_HOME`           | `/home/opencode/.cache`       | Directory cache                                         |
| `XDG_DATA_HOME`            | `/home/opencode/.local/share` | Directory dati                                          |

### Opzioni del Server (Flag CLI)

Il server accetta queste opzioni aggiuntive quando si sovrascrive il comando predefinito:

```bash
docker run ... ghcr.io/anomalyco/opencode/server:debian \
  opencode serve --hostname=0.0.0.0 --port=3000 --cors=https://example.com
```

| Flag            | Predefinita      | Descrizione                         |
| --------------- | ---------------- | ----------------------------------- |
| `--port`        | `0` (casuale)    | Porta su cui ascoltare              |
| `--hostname`    | `127.0.0.1`      | Hostname a cui associarsi           |
| `--mdns`        | `false`          | Abilita il rilevamento servizi mDNS |
| `--mdns-domain` | `opencode.local` | Nome dominio mDNS personalizzato    |
| `--cors`        | `[]`             | Domini CORS aggiuntivi consentiti   |

## Montaggio di Volumi

Monta questi volumi per persistere i dati e condividere le risorse:

### Workspace (Richiesto)

```bash
-v /path/to/workspace:/workspace
```

È qui che OpenCode opera sui tuoi file di progetto. Monta il tuo repository qui.

### Chiavi SSH

```bash
-v ~/.ssh:/home/opencode/.ssh:ro
```

Accesso in sola lettura alle chiavi SSH per clonare repository privati.

### Configurazione Git

```bash
-v ~/.gitconfig:/home/opencode/.gitconfig:ro
```

Eredita l'identità utente Git dall'host.

### Configurazione OpenCode

```bash
-v ~/.config/opencode:/home/opencode/.config/opencode
```

Mantieni le impostazioni di OpenCode tra i riavvii del contenitore.

### Cache

```bash
-v opencode_cache:/home/opencode/.cache
```

Cache per pacchetti npm, language server e altri strumenti scaricati.

## Porte

| Porta  | Protocollo | Descrizione                         |
| ------ | ---------- | ----------------------------------- |
| `3000` | HTTP       | API principale del server (default) |

La porta può essere rimappata tramite il flag `-p` di Docker:

```bash
-p 8080:3000  # Accedi al server su http://localhost:8080
```

## Utente e Permessi

Il contenitore viene eseguito come utente non-root (`opencode`, UID 1000) per sicurezza. Questo utente ha accesso `sudo` senza password per attività amministrative:

```bash
# Esegui comandi come utente opencode
docker exec -it opencode-server sudo -u opencode <command>

# Ottieni shell come utente opencode
docker exec -it opencode-server sudo -u opencode /bin/bash
```

Se hai bisogno dell'accesso root:

```bash
docker exec -it opencode-server /bin/bash
```

## Strumenti Installati

L'immagine include questi strumenti out of the box:

| Strumento         | Descrizione                                       |
| ----------------- | ------------------------------------------------- |
| `opencode`        | CLI di OpenCode                                   |
| `bun`             | Runtime JavaScript e gestore pacchetti            |
| `bunx`            | Equivalente di Bun per npx (esegue pacchetti npm) |
| `uv`              | Gestore pacchetti Python                          |
| `git`             | Controllo versione                                |
| `git-lfs`         | Estensione per archivi di file grandi per Git     |
| `build-essential` | GCC, make e librerie di compilazione              |
| `curl`            | Client HTTP                                       |
| `wget`            | Utilità per download file                         |
| `openssh-client`  | Client SSH e strumenti per chiavi                 |
| `xz-utils`        | Utilità di compressione                           |

### Usare bun

```bash
# Esegui un pacchetto Node.js
docker exec -it opencode-server bunx create-next-app

# Installa dipendenze
docker exec -it opencode-server bun install
```

### Usare uv

```bash
# Installa un pacchetto Python
docker exec -it opencode-server uv pip install pandas

# Esegui uno script Python
docker exec -it opencode-server uv run script.py
```

### Usare git

```bash
# Clona un repository nel workspace
docker exec -it opencode-server git clone https://github.com/user/repo.git /workspace/repo
```

## Health Check

Il contenitore include un health check integrato che verifica che il server risponda:

```bash
# Verifica stato di salute del contenitore
docker inspect --format='{{.State.Health.Status}}' opencode-server
```

L'endpoint di salute restituisce HTTP 200 quando è sano:

```bash
# Health check manuale
curl -f http://localhost:3000/health
```

Configurazione health check:

- Intervallo: 30 secondi
- Timeout: 10 secondi
- Periodo di avvio: 10 secondi
- Retry: 3

## Esempio Docker Compose

Crea un file `docker-compose.yml`:

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

Avvia lo stack:

```bash
docker-compose up -d
```

## Build dal Codice Sorgente

Per buildare l'immagine del server dal codice sorgente:

### Clona il repository

```bash
git clone https://github.com/anomalyco/opencode.git
cd opencode
```

### Build variante Debian

```bash
docker build \
  -f packages/containers/server/docker/Dockerfile.debian \
  -t opencode-server:local \
  .
```

### Build variante Alpine

```bash
docker build \
  -f packages/containers/server/docker/Dockerfile.alpine \
  -t opencode-server:alpine-local \
  .
```

### Esegui la tua build locale

```bash
docker run -d \
  -p 3000:3000 \
  -e OPENCODE_SERVER_PASSWORD=dev_password \
  -v $(pwd)/workspace:/workspace \
  opencode-server:local
```

## Risoluzione Problemi

### Il server non si avvia

Controlla i log:

```bash
docker logs opencode-server
```

Problemi comuni:

- `OPENCODE_SERVER_PASSWORD` mancante - il server rifiuta di avviarsi senza autenticazione
- Porta già in uso - cambia il mapping della porta host

### Autenticazione fallita

Assicurati che la password corrisponda esattamente. Il server usa HTTP Basic Auth:

```bash
# Testa autenticazione
curl -u opencode:your_password http://localhost:3000/health
```

### Errori di permessi del workspace

Assicurati che la directory montata sia scrivibile da UID 1000:

```bash
# Correggi proprietà
sudo chown -R 1000:1000 /path/to/workspace
```

### Avvio lento

Il primo download include language server e strumenti. Controlla il progresso:

```bash
docker logs -f opencode-server
```

### Il contenitore non può raggiungere internet

Controlla la configurazione DNS:

```bash
docker exec opencode-server ping -c 3 8.8.8.8
docker exec opencode-server cat /etc/resolv.conf
```

### Health check fallito

Verifica che il server sia effettivamente in esecuzione:

```bash
docker exec opencode-server curl -f http://localhost:3000/health
```

### Chiave SSH non funziona

Assicurati che i permessi della chiave siano corretti dentro il contenitore:

```bash
docker exec opencode-server sudo chmod 600 /home/opencode/.ssh/id_rsa
docker exec opencode-server sudo chmod 644 /home/opencode/.ssh/id_rsa.pub
```
