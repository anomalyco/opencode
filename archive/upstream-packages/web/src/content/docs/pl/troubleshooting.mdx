---
title: Rozwiązywanie problemów
description: Typowe problemy i sposoby ich rozwiązywania.
---

Aby debugować problemy z opencode, zacznij od sprawdzenia dzienników i danych lokalnych przechowywanych na dysku.

---

## Dzienniki

Pliki logów są zapisywane w:

- **macOS/Linux**: `~/.local/share/opencode/log/`
- **Windows**: Naciśnij `WIN+R` i wklej `%USERPROFILE%\.local\share\opencode\log`

Nazwy plików dziennika zawierają znaczniki czasu (np. `2025-01-09T123456.log`) i przechowywanych jest 10 ostatnich plików dziennika.

Możesz ustawić poziom dziennika za pomocą opcji wiersza poleceń `--log-level`, aby uzyskać bardziej szczegółowe informacje debugowania. Na przykład `opencode --log-level DEBUG`.

---

## Przechowywanie danych

opencode przechowuje dane sesji i inne dane aplikacji na dysku pod adresem:

- **macOS/Linux**: `~/.local/share/opencode/`
- **Windows**: Naciśnij `WIN+R` i wklej `%USERPROFILE%\.local\share\opencode`

Ten katalog zawiera:

- `auth.json` - Authentication data like API keys, OAuth tokens
- `log/` - Application logs
- `project/` — Dane specyficzne dla projektu, takie jak dane sesji i komunikatów
  - Jeśli projekt znajduje się w repozytorium Git, jest on przechowywany w `./<project-slug>/storage/`
  - If it is not a Git repo, it is stored in `./global/storage/`

---

## Aplikacja desktopowa

opencode Desktop uruchamia w tle lokalny serwer opencode (sidecar `opencode-cli`). Większość problemów jest spowodowana nieprawidłowo działającą wtyczką, uszkodzoną pamięcią podręczną lub złymi ustawieniami serwera.

### Szybkie sprawdzenie

- Całkowicie zakończ i uruchom ponownie aplikację.
- Jeśli aplikacja wyświetli ekran błędu, kliknij **Uruchom ponownie** i skopiuj szczegóły błędu.
- Tylko macOS: menu `OpenCode` -> **Załaduj ponownie przeglądarkę internetową** (pomaga, jeśli interfejs użytkownika jest pusty/zawieszony).

---

### Wyłączanie wtyczek

Jeśli aplikacja komputerowa ulega awarii podczas uruchamiania, zawiesza się lub zachowuje się dziwnie, zacznij od wyłączenia wtyczek.

#### Sprawdź konfigurację globalną

Otwórz globalny plik konfiguracyjny i poszukaj klucza `plugin`.

- **macOS/Linux**: `~/.config/opencode/opencode.jsonc` (lub `~/.config/opencode/opencode.json`)
- **macOS/Linux** (starsze instalacje): `~/.local/share/opencode/opencode.jsonc`
- **Windows**: Naciśnij `WIN+R` i wklej `%USERPROFILE%\.config\opencode\opencode.jsonc`

Jeśli masz skonfigurowane wtyczki, tymczasowo je wyłącz, usuwając klucz lub ustawiając go na pustą tablicę:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [],
}
```

#### Sprawdź katalogi wtyczek

opencode może także ładować lokalne wtyczki z dysku. Tymczasowo usuń je (lub zmień nazwę folderu) i uruchom ponownie aplikację komputerową:

- **Wtyczki globalne**
  - **macOS/Linux**: `~/.config/opencode/plugins/`
  - **Windows**: Naciśnij `WIN+R` i wklej `%USERPROFILE%\.config\opencode\plugins`
- **Wtyczki projektowe** (tylko jeśli używasz konfiguracji dla poszczególnych projektów)
  - `<your-project>/.opencode/plugins/`

Jeśli aplikacja ponownie zacznie działać, włączaj ponownie wtyczki pojedynczo, aby dowiedzieć się, która powoduje problem.

---

### Wyczyść pamięć podręczną

Jeśli wyłączenie wtyczek nie pomoże (lub instalacja wtyczki utknęła), wyczyść pamięć podręczną, aby opencode mógł ją odbudować.

1. Całkowicie zamknij opencode Desktop.
2. Usuń katalog pamięci podręcznej:

- **macOS**: Finder -> `Cmd+Shift+G` -> paste `~/.cache/opencode`
- **Linux**: usuń `~/.cache/opencode` (lub uruchom `rm -rf ~/.cache/opencode`)
- **Windows**: Naciśnij `WIN+R` i wklej `%USERPROFILE%\.cache\opencode`

3. Uruchom ponownie opencode Desktop.

---

### Napraw problemy z połączeniem z serwerem

opencode Desktop może uruchomić własny serwer lokalny (domyślnie) lub połączyć się ze skonfigurowanym adresem URL serwera.

Jeśli zobaczysz okno dialogowe **„Połączenie nie powiodło się”** (lub aplikacja nigdy nie wychodzi poza ekran powitalny), sprawdź, czy jest niestandardowy adres URL serwera.

#### Wyczyść domyślny adres URL serwera na komputerze

Na ekranie głównym kliknij nazwę serwera (z kropką stanu), aby otworzyć selektor serwerów. W sekcji **Serwer domyślny** kliknij **Wyczyść**.

#### Usuń `server.port` / `server.hostname` ze swojej konfiguracji

Jeśli Twój `opencode.json(c)` zawiera sekcję `server`, tymczasowo usuń ją i uruchom ponownie aplikację komputerową.

#### Sprawdź zmienne środowiskowe

Jeśli w swoim środowisku masz ustawiony `OPENCODE_PORT`, aplikacja komputerowa spróbuje użyć tego portu dla serwera lokalnego.

- usuń `OPENCODE_PORT` (lub wybierz wolny port) i uruchom ponownie.

---

### Linux: Problemy z Wayland / X11

W systemie Linux, niektóre konfiguracje Wayland mogą powodować puste okna lub błędy kompozytora.

- Jeśli korzystasz z Wayland, a aplikacja jest pusta/ ulega awarii, spróbuj uruchomić ją za pomocą `OC_ALLOW_WAYLAND=1`.
- Jeśli to pogorszy sprawę, usuń go i zamiast tego spróbuj uruchomić w sesji X11.

---

### Windows: Środowisko uruchomieniowe WebView2

W systemie Windows opencode Desktop wymaga Microsoft Edge **WebView2 Runtime**. Jeśli aplikacja otwiera się w pustym oknie lub nie uruchamia się, zainstaluj/zaktualizuj WebView2 i spróbuj ponownie.

---

### Windows: Ogólne problemy z wydajnością

Jeśli doświadczasz niskiej wydajności, problemów z dostępem do plików lub problemów z terminalem w systemie Windows, spróbuj użyć [WSL (podsystem Windows dla systemu Linux) (./windows-wsl). WSL zapewnia środowisko Linux, które płynniej współpracuje z funkcjami opencode.

---

### Brak powiadomień

opencode Desktop pokazuje powiadomienia systemowe tylko wtedy, gdy:

- powiadomienia są włączone dla opencode w ustawieniach systemu operacyjnego, oraz
- okno aplikacji nie jest aktywne.

---

### Resetowanie pamięci aplikacji

Jeśli aplikacja nie uruchamia się i nie możesz wyczyścić ustawień w interfejsie użytkownika, zresetuj zapisany stan aplikacji komputerowej.

1. Zamknij całkowicie opencode Desktop.
2. Znajdź i usuń te pliki (znajdują się w katalogu danych aplikacji opencode Desktop):

- `opencode.settings.dat` (domyślny adres URL serwera na komputerze stacjonarnym)
- `opencode.global.dat` i `opencode.workspace.*.dat` (stan interfejsu użytkownika, taki jak najnowsze serwery/projekty)

Aby szybko znaleźć katalog:

- **macOS**: Finder -> `Cmd+Shift+G` -> `~/Library/Application Support` (następnie wyszukaj nazwy plików powyżej)
- **Linux**: wyszukaj powyższe nazwy plików pod `~/.local/share`
- **Windows**: Naciśnij `WIN+R` -> `%APPDATA%` (następnie wyszukaj nazwy plików powyżej)

---

## Uzyskiwanie pomocy

Jeśli masz problemy z opencode:

1. **Zgłoś problem na GitHub**

   Najlepszym sposobem zgłaszania błędów lub zgłaszania żądań funkcji jest skorzystanie z naszego repozytorium GitHub:

   [**github.com/anomalyco/opencode/issues**](https://github.com/anomalyco/opencode/issues)

   Przed utworzeniem nowego problemu przeszukaj istniejące i sprawdź, czy Twój problem nie został już zgłoszony.

2. **Dołącz do naszego Discorda**

   Aby uzyskać pomoc w czasie rzeczywistym i dyskusję społeczności, dołącz do naszego serwera Discord:

   [**opencode.ai/discord**](https://opencode.ai/discord)

---

## Typowe problemy

Oto kilka typowych problemów i sposobów ich rozwiązania.

---

### opencode nie uruchamia się

1. Sprawdź dzienniki pod kątem komunikatów o błędach
2. Spróbuj uruchomić z `--print-logs`, aby zobaczyć dane wyjściowe w terminalu
3. Upewnij się, że masz najnowszą wersję z `opencode upgrade`

---

### Problemy z uwierzytelnianiem

1. Spróbuj ponownie uwierzytelnić się za pomocą polecenia `/connect` w TUI
2. Sprawdź, czy klucze API są ważne
3. Upewnij się, że Twoja sieć umożliwia połączenia z interfejsem API dostawcy

---

### Model niedostępny

1. Sprawdź, czy dokonałeś uwierzytelnienia u dostawcy
2. Sprawdź, czy nazwa modelu w konfiguracji jest poprawna
3. Niektóre modele mogą wymagać określonego dostępu lub subskrypcji

Jeśli napotkasz `ProviderModelNotFoundError`, najprawdopodobniej
błędnie odwołujesz się gdzieś do modelu.
Modele powinny być wskazywane w ten sposób: `<providerId>/<modelId>`

Przykłady:

- `openai/gpt-4.1`
- `openrouter/google/gemini-2.5-flash`
- `opencode/kimi-k2`

Aby dowiedzieć się, do jakich modeli masz dostęp, uruchom `opencode models`

---

### ProviderInitError

Jeśli napotkasz błąd ProviderInitError, prawdopodobnie masz nieprawidłową lub uszkodzoną konfigurację.

Aby rozwiązać ten problem:

1. Najpierw sprawdź, czy Twój dostawca jest prawidłowo skonfigurowany, postępując zgodnie z [przewodnikiem dostawców](/docs/providers)
2. Jeśli problem będzie się powtarzał, spróbuj wyczyścić zapisaną konfigurację:

   ```bash
   rm -rf ~/.local/share/opencode
   ```

   W systemie Windows naciśnij `WIN+R` i usuń: `%USERPROFILE%\.local\share\opencode`

3. Ponownie uwierzytelnij się u swojego dostawcy za pomocą polecenia `/connect` w TUI.

---

### Błędy AI_APICallError i problemy z pakietami dostawców

Jeśli napotkasz błędy wywołań API, może to wynikać z nieaktualnych pakietów dostawców. opencode dynamicznie instaluje pakiety dostawców (OpenAI, Anthropic, Google itp.) w razie potrzeby i przechowuje je lokalnie w pamięci podręcznej.

Aby rozwiązać problemy z pakietem dostawcy:

1. Wyczyść pamięć podręczną pakietu dostawcy:

   ```bash
   rm -rf ~/.cache/opencode
   ```

   W systemie Windows naciśnij `WIN+R` i usuń: `%USERPROFILE%\.cache\opencode`

2. Uruchom ponownie kod opencode, aby ponownie zainstalować najnowsze pakiety dostawców

Zmusi to opencode do pobrania najnowszych wersji pakietów dostawców, co często rozwiązuje problemy ze zgodnością z parametrami modelu i zmianami API.

---

### Kopiowanie/wklejanie nie działa na Linuxie

Aby funkcja kopiowania/wklejania działała, użytkownicy systemu Linux muszą mieć zainstalowane jedno z następujących narzędzi schowka:

**Dla systemów X11:**

```bash
apt install -y xclip
# or
apt install -y xsel
```

**Dla systemów Wayland:**

```bash
apt install -y wl-clipboard
```

**Dla środowisk headless:**

```bash
apt install -y xvfb
# and run:
Xvfb :99 -screen 0 1024x768x24 > /dev/null 2>&1 &
export DISPLAY=:99.0
```

opencode wykryje, czy używasz Waylanda i wolisz `wl-clipboard`, w przeciwnym razie spróbuje znaleźć narzędzia schowka w kolejności: `xclip` i `xsel`.
