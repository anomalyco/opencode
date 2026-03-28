# OpenCode Server Docker Dokumentacija

Ovaj vodič pokriva pokretanje OpenCode-a u server modu unutar Docker kontejnera.

## Uvod

OpenCode Server je bezglavo raspoređivanje OpenCode-a koje radi kao pozadinska usluga, dostupna putem HTTP API-ja. Docker slika pruža kompletno runtime okruženje sa svim potrebnim alatima unaprijed instaliranim, što ga čini idealnim za:

- Udaljena razvojna okruženja
- CI/CD integraciju
- Dijeljene coding instance za tim
- Pokretanje OpenCode-a na serverima bez GUI-ja

## Brzi Početak

Pokrenite OpenCode Server sa sigurnom lozinkom:

```bash
docker run -d \
  --name opencode-server \
  -p 3000:3000 \
  -e OPENCODE_SERVER_PASSWORD=your_secure_password \
  -v opencode_workspace:/workspace \
  ghcr.io/anomalyco/opencode/server:debian
```

Pristupite serveru na `http://localhost:3000`.

## Varijante Slike

Dostupne su dvije varijante bazne slike:

| Varijanta | Bazna Slika        | Veličina | Slučaj Korištenja                  |
| --------- | ------------------ | -------- | ---------------------------------- |
| `debian`  | Debian Trixie Slim | ~500MB   | Preporučeno za većinu korisnika    |
| `alpine`  | Alpine Edge        | ~200MB   | Minimalan otisak, brže preuzimanje |

### Preuzimanje Specifičnih Varijanti

```bash
# Debian (preporučeno)
docker pull ghcr.io/anomalyco/opencode/server:debian

# Alpine (minimalno)
docker pull ghcr.io/anomalyco/opencode/server:alpine
```

## Varijable Okruženja

| Varijabla                  | Zadana vrijednost             | Opis                                                |
| -------------------------- | ----------------------------- | --------------------------------------------------- |
| `OPENCODE_SERVER_PASSWORD` | (nema)                        | **Obavezno.** Lozinka za HTTP Basic autentifikaciju |
| `OPENCODE_SERVER_USERNAME` | `opencode`                    | Korisničko ime za HTTP Basic autentifikaciju        |
| `XDG_CONFIG_HOME`          | `/home/opencode/.config`      | Direktorij za konfiguraciju                         |
| `XDG_CACHE_HOME`           | `/home/opencode/.cache`       | Direktorij za keš                                   |
| `XDG_DATA_HOME`            | `/home/opencode/.local/share` | Direktorij za podatke                               |

### Opcije Servera (CLI zastavice)

Server prihvata ove dodatne opcije prilikom prepisivanja zadane naredbe:

```bash
docker run ... ghcr.io/anomalyco/opencode/server:debian \
  opencode serve --hostname=0.0.0.0 --port=3000 --cors=https://example.com
```

| Zastavica       | Zadana vrijednost | Opis                            |
| --------------- | ----------------- | ------------------------------- |
| `--port`        | `0` (nasumično)   | Port za slušanje                |
| `--hostname`    | `127.0.0.1`       | Hostname za povezivanje         |
| `--mdns`        | `false`           | Omogući mDNS otkrivanje servisa |
| `--mdns-domain` | `opencode.local`  | Prilagođeno mDNS ime domene     |
| `--cors`        | `[]`              | Dodatni CORS-dozvoljeni domeni  |

## Montiranje Volumena

Montirajte ove volumene za perzistenciju podataka i dijeljenje resursa:

### Radni Prostor (Obavezno)

```bash
-v /path/to/workspace:/workspace
```

Ovo je mjesto gdje OpenCode radi na vašim projektnim fajlovima. Montirajte vaš repozitorijum koda ovdje.

### SSH Ključevi

```bash
-v ~/.ssh:/home/opencode/.ssh:ro
```

Pristup samo za čitanje SSH ključevima za kloniranje privatnih repozitorijuma.

### Git Konfiguracija

```bash
-v ~/.gitconfig:/home/opencode/.gitconfig:ro
```

Naslijedite Git korisnički identitet od hosta.

### OpenCode Konfiguracija

```bash
-v ~/.config/opencode:/home/opencode/.config/opencode
```

Perzistirajte OpenCode postavke između restarta kontejnera.

### Keš

```bash
-v opencode_cache:/home/opencode/.cache
```

Keširajte npm pakete, language servere i druge preuzete alate.

## Portovi

| Port   | Protokol | Opis                       |
| ------ | -------- | -------------------------- |
| `3000` | HTTP     | Glavni server API (zadano) |

Port se može remapirati putem Docker `-p` zastavice:

```bash
-p 8080:3000  # Pristup serveru na http://localhost:8080
```

## Korisnik i Dozvole

Kontejner radi kao korisnik koji nije root (`opencode`, UID 1000) iz sigurnosnih razloga. Ovaj korisnik ima `sudo` pristup bez lozinke za administrativne zadatke:

```bash
# Izvršavanje naredbi kao opencode korisnik
docker exec -it opencode-server sudo -u opencode <command>

# Dobijanje shella kao opencode korisnik
docker exec -it opencode-server sudo -u opencode /bin/bash
```

Ako vam treba root pristup:

```bash
docker exec -it opencode-server /bin/bash
```

## Instalirani Alati

Slika uključuje ove alate odmah:

| Alat              | Opis                                            |
| ----------------- | ----------------------------------------------- |
| `opencode`        | OpenCode CLI                                    |
| `bun`             | JavaScript runtime i package manager            |
| `bunx`            | Bun-ov ekvivalent npx-u (pokretanje npm paketa) |
| `uv`              | Python package manager                          |
| `git`             | Kontrola verzija                                |
| `git-lfs`         | Proširenje za velike fajlove za Git             |
| `build-essential` | GCC, make i build biblioteke                    |
| `curl`            | HTTP klijent                                    |
| `wget`            | Utilitat za preuzimanje fajlova                 |
| `openssh-client`  | SSH klijent i alati za ključeve                 |
| `xz-utils`        | Kompresijski alati                              |

### Korištenje bun-a

```bash
# Pokretanje Node.js paketa
docker exec -it opencode-server bunx create-next-app

# Instalacija zavisnosti
docker exec -it opencode-server bun install
```

### Korištenje uv-a

```bash
# Instalacija Python paketa
docker exec -it opencode-server uv pip install pandas

# Pokretanje Python skripte
docker exec -it opencode-server uv run script.py
```

### Korištenje git-a

```bash
# Kloniranje repozitorijuma u radni prostor
docker exec -it opencode-server git clone https://github.com/user/repo.git /workspace/repo
```

## Health Check

Kontejner uključuje ugrađeni health check koji provjerava da server reagira:

```bash
# Provjera zdravlja kontejnera
docker inspect --format='{{.State.Health.Status}}' opencode-server
```

Health endpoint vraća HTTP 200 kada je zdrav:

```bash
# Ručna provjera zdravlja
curl -f http://localhost:3000/health
```

Konfiguracija health check-a:

- Interval: 30 sekundi
- Timeout: 10 sekundi
- Period pokretanja: 10 sekundi
- Pokušaji: 3

## Primjer Docker Compose-a

Kreirajte `docker-compose.yml` fajl:

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

Pokrenite stack:

```bash
docker-compose up -d
```

## Buildanje iz Izvora

Da biste buildali server sliku iz izvora:

### Klonirajte repozitorijum

```bash
git clone https://github.com/anomalyco/opencode.git
cd opencode
```

### Buildajte Debian varijantu

```bash
docker build \
  -f packages/containers/server/docker/Dockerfile.debian \
  -t opencode-server:local \
  .
```

### Buildajte Alpine varijantu

```bash
docker build \
  -f packages/containers/server/docker/Dockerfile.alpine \
  -t opencode-server:alpine-local \
  .
```

### Pokrenite vaš lokalni build

```bash
docker run -d \
  -p 3000:3000 \
  -e OPENCODE_SERVER_PASSWORD=dev_password \
  -v $(pwd)/workspace:/workspace \
  opencode-server:local
```

## Rješavanje Problema

### Server se ne pokreće

Provjerite logove:

```bash
docker logs opencode-server
```

Česti problemi:

- Nedostaje `OPENCODE_SERVER_PASSWORD` - server odbija da se pokrene bez autentifikacije
- Port je već u upotrebi - promijenite mapping host porta

### Autentifikacija ne uspijeva

Osigurajte da se lozinka podudara tačno. Server koristi HTTP Basic Auth:

```bash
# Testiranje autentifikacije
curl -u opencode:your_password http://localhost:3000/health
```

### Greške sa dozvolama radnog prostora

Osigurajte da je montirani direktorij writeable od strane UID 1000:

```bash
# Ispravljanje vlasništva
sudo chown -R 1000:1000 /path/to/workspace
```

### Sporo pokretanje

Prvo pokretanje preuzima language servere i alate. Provjerite napredak:

```bash
docker logs -f opencode-server
```

### Kontejner ne može pristupiti internetu

Provjerite DNS konfiguraciju:

```bash
docker exec opencode-server ping -c 3 8.8.8.8
docker exec opencode-server cat /etc/resolv.conf
```

### Health check ne uspijeva

Provjerite da server stvarno radi:

```bash
docker exec opencode-server curl -f http://localhost:3000/health
```

### SSH ključ ne radi

Osigurajte ispravne dozvole za ključeve unutar kontejnera:

```bash
docker exec opencode-server sudo chmod 600 /home/opencode/.ssh/id_rsa
docker exec opencode-server sudo chmod 644 /home/opencode/.ssh/id_rsa.pub
```
