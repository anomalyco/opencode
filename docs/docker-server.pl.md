# Dokumentacja Docker OpenCode Server

Ten przewodnik obejmuje uruchamianie OpenCode w trybie serwerowym wewnątrz kontenerów Docker.

## Wprowadzenie

OpenCode Server to wdrożenie OpenCode bez interfejsu graficznego, działające jako usługa w tle, dostępne przez API HTTP. Obraz Docker zapewnia kompletne środowisko uruchomieniowe ze wszystkimi niezbędnymi narzędziami wstępnie zainstalowanymi, co czyni go idealnym do:

- Zdalnych środowisk programistycznych
- Integracji CI/CD
- Wspólnych instancji kodowania dla zespołów
- Uruchamiania OpenCode na serwerach bez interfejsu graficznego

## Szybki start

Uruchom OpenCode Server z bezpiecznym hasłem:

```bash
docker run -d \
  --name opencode-server \
  -p 3000:3000 \
  -e OPENCODE_SERVER_PASSWORD=your_secure_password \
  -v opencode_workspace:/workspace \
  ghcr.io/anomalyco/opencode/server:debian
```

Dostęp do serwera pod adresem `http://localhost:3000`.

## Warianty obrazu

Dostępne są dwa warianty obrazów bazowych:

| Wariant  | Obraz bazowy       | Rozmiar | Przypadek użycia                      |
| -------- | ------------------ | ------- | ------------------------------------- |
| `debian` | Debian Trixie Slim | ~500MB  | Zalecane dla większości użytkowników  |
| `alpine` | Alpine Edge        | ~200MB  | Minimalny rozmiar, szybsze pobieranie |

### Pobieranie określonych wariantów

```bash
# Debian (zalecane)
docker pull ghcr.io/anomalyco/opencode/server:debian

# Alpine (minimalny)
docker pull ghcr.io/anomalyco/opencode/server:alpine
```

## Zmienne środowiskowe

| Zmienna                    | Domyślna                      | Opis                                               |
| -------------------------- | ----------------------------- | -------------------------------------------------- |
| `OPENCODE_SERVER_PASSWORD` | (brak)                        | **Wymagane.** Hasło do uwierzytelniania HTTP Basic |
| `OPENCODE_SERVER_USERNAME` | `opencode`                    | Nazwa użytkownika do uwierzytelniania HTTP Basic   |
| `XDG_CONFIG_HOME`          | `/home/opencode/.config`      | Katalog konfiguracyjny                             |
| `XDG_CACHE_HOME`           | `/home/opencode/.cache`       | Katalog cache                                      |
| `XDG_DATA_HOME`            | `/home/opencode/.local/share` | Katalog danych                                     |

### Opcje serwera (flagi CLI)

Serwer akceptuje te dodatkowe opcje podczas nadpisywania domyślnego polecenia:

```bash
docker run ... ghcr.io/anomalyco/opencode/server:debian \
  opencode serve --hostname=0.0.0.0 --port=3000 --cors=https://example.com
```

| Flaga           | Domyślna         | Opis                            |
| --------------- | ---------------- | ------------------------------- |
| `--port`        | `0` (losowy)     | Port do nasłuchiwania           |
| `--hostname`    | `127.0.0.1`      | Nazwa hosta do powiązania       |
| `--mdns`        | `false`          | Włącz wykrywanie usług mDNS     |
| `--mdns-domain` | `opencode.local` | Niestandardowa domena mDNS      |
| `--cors`        | `[]`             | Dodatkowe dozwolone domeny CORS |

## Montowanie woluminów

Zamontuj te woluminy, aby zachować dane i udostępniać zasoby:

### Przestrzeń robocza (Wymagane)

```bash
-v /path/to/workspace:/workspace
```

Tutaj OpenCode operuje na plikach projektu. Zamontuj tutaj swoje repozytorium kodu.

### Klucze SSH

```bash
-v ~/.ssh:/home/opencode/.ssh:ro
```

Dostęp tylko do odczytu do kluczy SSH do klonowania prywatnych repozytoriów.

### Konfiguracja Git

```bash
-v ~/.gitconfig:/home/opencode/.gitconfig:ro
```

Dziedziczenie tożsamości użytkownika Git z hosta.

### Konfiguracja OpenCode

```bash
-v ~/.config/opencode:/home/opencode/.config/opencode
```

Utrzymywanie ustawień OpenCode między restartami kontenera.

### Cache

```bash
-v opencode_cache:/home/opencode/.cache
```

Cache pakietów npm, serwerów językowych i innych pobranych narzędzi.

## Porty

| Port   | Protokół | Opis                          |
| ------ | -------- | ----------------------------- |
| `3000` | HTTP     | Główne API serwera (domyślne) |

Port można zmienić za pomocą flagi `-p` Dockera:

```bash
-p 8080:3000  # Dostęp do serwera pod http://localhost:8080
```

## Użytkownik i uprawnienia

Kontener działa jako użytkownik niebędący root (`opencode`, UID 1000) ze względów bezpieczeństwa. Ten użytkownik ma dostęp do `sudo` bez hasła do zadań administracyjnych:

```bash
# Wykonaj polecenia jako użytkownik opencode
docker exec -it opencode-server sudo -u opencode <command>

# Uzyskaj powłokę jako użytkownik opencode
docker exec -it opencode-server sudo -u opencode /bin/bash
```

Jeśli potrzebujesz dostępu root:

```bash
docker exec -it opencode-server /bin/bash
```

## Zainstalowane narzędzia

Obraz zawiera te narzędzia out-of-the-box:

| Narzędzie         | Opis                                                     |
| ----------------- | -------------------------------------------------------- |
| `opencode`        | CLI OpenCode                                             |
| `bun`             | Środowisko uruchomieniowe JavaScript i menedżer pakietów |
| `bunx`            | Odpowiednik Bun dla npx (uruchamianie pakietów npm)      |
| `uv`              | Menedżer pakietów Python                                 |
| `git`             | Kontrola wersji                                          |
| `git-lfs`         | Rozszerzenie do przechowywania dużych plików w Git       |
| `build-essential` | GCC, make i biblioteki budowania                         |
| `curl`            | Klient HTTP                                              |
| `wget`            | Narzędzie do pobierania plików                           |
| `openssh-client`  | Klient SSH i narzędzia do kluczy                         |
| `xz-utils`        | Narzędzia kompresji                                      |

### Używanie bun

```bash
# Uruchom pakiet Node.js
docker exec -it opencode-server bunx create-next-app

# Zainstaluj zależności
docker exec -it opencode-server bun install
```

### Używanie uv

```bash
# Zainstaluj pakiet Python
docker exec -it opencode-server uv pip install pandas

# Uruchom skrypt Python
docker exec -it opencode-server uv run script.py
```

### Używanie git

```bash
# Klonuj repozytorium do przestrzeni roboczej
docker exec -it opencode-server git clone https://github.com/user/repo.git /workspace/repo
```

## Sprawdzanie zdrowia

Kontener zawiera wbudowane sprawdzanie zdrowia, które weryfikuje, czy serwer odpowiada:

```bash
# Sprawdź stan zdrowia kontenera
docker inspect --format='{{.State.Health.Status}}' opencode-server
```

Punkt końcowy zdrowia zwraca HTTP 200, gdy jest zdrowy:

```bash
# Ręczne sprawdzanie zdrowia
curl -f http://localhost:3000/health
```

Konfiguracja sprawdzania zdrowia:

- Interwał: 30 sekund
- Timeout: 10 sekund
- Okres startowy: 10 sekund
- Próby: 3

## Przykład Docker Compose

Utwórz plik `docker-compose.yml`:

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

Uruchom stos:

```bash
docker-compose up -d
```

## Budowanie ze źródła

Aby zbudować obraz serwera ze źródła:

### Klonuj repozytorium

```bash
git clone https://github.com/anomalyco/opencode.git
cd opencode
```

### Buduj wariant Debian

```bash
docker build \
  -f packages/containers/server/docker/Dockerfile.debian \
  -t opencode-server:local \
  .
```

### Buduj wariant Alpine

```bash
docker build \
  -f packages/containers/server/docker/Dockerfile.alpine \
  -t opencode-server:alpine-local \
  .
```

### Uruchom swoją lokalną kompilację

```bash
docker run -d \
  -p 3000:3000 \
  -e OPENCODE_SERVER_PASSWORD=dev_password \
  -v $(pwd)/workspace:/workspace \
  opencode-server:local
```

## Rozwiązywanie problemów

### Serwer nie startuje

Sprawdź logi:

```bash
docker logs opencode-server
```

Częste problemy:

- Brak `OPENCODE_SERVER_PASSWORD` - serwer odmawia startu bez uwierzytelniania
- Port już w użyciu - zmień mapowanie portów hosta

### Uwierzytelnianie nie działa

Upewnij się, że hasło jest dokładnie dopasowane. Serwer używa HTTP Basic Auth:

```bash
# Testuj uwierzytelnianie
curl -u opencode:your_password http://localhost:3000/health
```

### Błędy uprawnień przestrzeni roboczej

Upewnij się, że zamontowany katalog jest zapisywalny przez UID 1000:

```bash
# Napraw własność
sudo chown -R 1000:1000 /path/to/workspace
```

### Wolny start

Pierwsze uruchomienie pobiera serwery językowe i narzędzia. Sprawdź postęp:

```bash
docker logs -f opencode-server
```

### Kontener nie może połączyć się z internetem

Sprawdź konfigurację DNS:

```bash
docker exec opencode-server ping -c 3 8.8.8.8
docker exec opencode-server cat /etc/resolv.conf
```

### Sprawdzanie zdrowia nie działa

Zweryfikuj, czy serwer faktycznie działa:

```bash
docker exec opencode-server curl -f http://localhost:3000/health
```

### Klucz SSH nie działa

Upewnij się, że klucze mają odpowiednie uprawnienia wewnątrz kontenera:

```bash
docker exec opencode-server sudo chmod 600 /home/opencode/.ssh/id_rsa
docker exec opencode-server sudo chmod 644 /home/opencode/.ssh/id_rsa.pub
```
