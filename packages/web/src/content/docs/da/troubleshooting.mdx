---
title: Fejlfinding
description: Almindelige problemer, og hvordan de løses.
---

For at fejlfinde problemer med OpenCode, start med at tjekke logfilerne og de lokale data, den gemmer på disken.

---

## Logfiler

Logfiler skrives til:

- **macOS/Linux**: `~/.local/share/opencode/log/`
- **Windows**: Tryk `WIN+R` og indsæt `%USERPROFILE%\.local\share\opencode\log`

Logfiler navngives med tidsstempler (f.eks. `2025-01-09T123456.log`) og de sidste 10 logfiler beholdes.

Du kan angive logniveauet med kommandolinjeflaget `--log-level` for at få mere detaljeret fejlfindingsinformation. For eksempel `opencode --log-level DEBUG`.

---

## Lagring

opencode gemmer sessionsdata og andre applikationsdata på disken på:

- **macOS/Linux**: `~/.local/share/opencode/`
- **Windows**: Tryk `WIN+R` og indsæt `%USERPROFILE%\.local\share\opencode`

Denne mappe indeholder:

- `auth.json` - Godkendelsesdata som API-nøgler, OAuth-tokens
- `log/` - Applikationslogs
- `project/` - Projektspecifikke data som sessions- og beskeddata
  - Hvis projektet er inden for et Git-repo, gemmes det i `./<project-slug>/storage/`
  - Hvis det ikke er et Git-repo, gemmes det i `./global/storage/`

---

## Desktop-app

OpenCode Desktop kører en lokal OpenCode-server (`opencode-cli` sidevognen) i baggrunden. De fleste problemer er forårsaget af et plugin, der fungerer dårligt, en ødelagt cache eller en dårlig serverindstilling.

### Hurtige tjek

- Afslut og start appen på ny.
- Hvis appen viser en fejlskærm, klikker du på **Start på ny** og kopierer fejldetaljerne.
- Kun macOS: `OpenCode`-menu -> **Genindlæs webvisning** (hjælper hvis UI er tom/frosset).

---

### Deaktiver plugins

Hvis skrivebordsappen går ned ved opstart, hænger eller opfører sig mærkeligt, start med at deaktivere plugins.

#### Tjek den globale konfiguration

Åbn den globale konfigurationsfil og se efter en `plugin`-nøgle.

- **macOS/Linux**: `~/.config/opencode/opencode.jsonc` (eller `~/.config/opencode/opencode.json`)
- **macOS/Linux** (ældre installationer): `~/.local/share/opencode/opencode.jsonc`
- **Windows**: Tryk `WIN+R` og indsæt `%USERPROFILE%\.config\opencode\opencode.jsonc`

Hvis du har konfigureret plugins, deaktiver dem midlertidigt ved at fjerne nøglen eller sætte den til et tomt array:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [],
}
```

#### Tjek plugin-mapper

OpenCode kan også indlæse lokale plugins fra disken. Flyt disse midlertidigt væk (eller giv mappen nyt navn) og start skrivebordsappen på ny:

- **Globale plugins**
  - **macOS/Linux**: `~/.config/opencode/plugins/`
  - **Windows**: Tryk `WIN+R` og indsæt `%USERPROFILE%\.config\opencode\plugins`
- **Projektplugins** (kun hvis du bruger konfiguration per projekt)
  - `<your-project>/.opencode/plugins/`

Hvis appen begynder at fungere igen, aktiverer du plugins én ad gangen for at finde ud af, hvilken som forårsager problemet.

---

### Ryd cachen

Hvis deaktivering af plugins ikke hjælper (eller en plugin-installation sidder fast), tøm cachen så OpenCode kan genopbygge den.

1. Afslut OpenCode Desktop helt.
2. Slet cache-mappen:

- **macOS**: Finder -> `Cmd+Shift+G` -> indsæt `~/.cache/opencode`
- **Linux**: slet `~/.cache/opencode` (eller kør `rm -rf ~/.cache/opencode`)
- **Windows**: Tryk `WIN+R` og indsæt `%USERPROFILE%\.cache\opencode`

3. Start OpenCode Desktop på ny.

---

### Løs problemer med serverforbindelse

OpenCode Desktop kan enten starte sin egen lokale server (standard) eller forbinde til en server URL, du har konfigureret.

Hvis du ser en **"Forbindelse mislykkedes"**-dialogboks (eller appen kommer aldrig forbi splash-skærmen), se efter en brugerdefineret server URL.

#### Slet standardserveren for skrivebordet URL

Fra startskærmen klikker du på servernavnet (med statusprikken) for at åbne servervælgeren. I delen **Standardserver** klikker du på **Slet**.

#### Fjern `server.port` / `server.hostname` fra din konfiguration

Hvis `opencode.json(c)` indeholder en `server`-del, fjern den midlertidigt og start skrivebordsappen på ny.

#### Tjek miljøvariabler

Hvis du har `OPENCODE_PORT` sat i dit miljø, vil skrivebordsappen prøve at bruge den port for den lokale server.

- Deaktiver `OPENCODE_PORT` (eller vælg en ledig port) og start på ny.

---

### Linux: Wayland / X11-problemer

På Linux kan nogle Wayland-opsætninger forårsage tomme vinduer eller kompositorfejl.

- Hvis du er på Wayland og appen er tom/crasher, prøv at starte med `OC_ALLOW_WAYLAND=1`.
- Hvis det gør ting værre, fjern det og prøv at starte under en X11-session i stedet.

---

### Windows: WebView2-runtime

På Windows kræver OpenCode Desktop Microsoft Edge **WebView2 Runtime**. Hvis appen åbnes i et tomt vindue eller ikke starter, installer/opdater WebView2 og prøv igen.

---

### Windows: Generelle ydeevneproblemer

Hvis du oplever langsom ydeevne, problemer med filadgang eller terminalproblemer på Windows, kan du prøve at bruge [WSL (Windows Subsystem for Linux)](/docs/windows-wsl). WSL giver et Linux-miljø som fungerer mere sømløst med funktionerne i OpenCode.

---

### Meddelelser vises ikke

OpenCode Desktop viser kun systemvarsler når:

- varsler er aktiveret for OpenCode i dine OS-indstillinger, og
- appvinduet ikke er fokuseret.

---

### Nulstil desktop-applagring (sidste udvej)

Hvis appen ikke starter og du ikke kan slette indstillingerne fra UI, nulstil skrivebordsappens gemte tilstand.

1. Afslut OpenCode Desktop.
2. Find og slet disse filer (de findes i OpenCode Desktop-appens datamappe):

- `opencode.settings.dat` (skrivebordsstandardserver URL)
- `opencode.global.dat` og `opencode.workspace.*.dat` (UI tilstand som nylige servere/projekter)

Sådan finder du mappen hurtigt:

- **macOS**: Finder -> `Cmd+Shift+G` -> `~/Library/Application Support` (søg derefter efter filnavnene ovenfor)
- **Linux**: søg under `~/.local/share` efter filnavnene ovenfor
- **Windows**: Tryk `WIN+R` -> `%APPDATA%` (søg derefter efter filnavnene ovenfor)

---

## Få hjælp

Hvis du oplever problemer med OpenCode:

1. **Rapporter problemer på GitHub**

   Den bedste måde at rapportere fejl eller bede om funktioner på er gennem vores GitHub-repo:

   [**github.com/anomalyco/opencode/issues**](https://github.com/anomalyco/opencode/issues)

   Før du opretter et nyt issue, søg i eksisterende issues for at se om dit problem allerede er rapporteret.

2. **Bliv en del af vores Discord**

   For hjælp i realtid og fællesskabsdiskussion, bliv en del af vores Discord-server:

   [**opencode.ai/discord**](https://opencode.ai/discord)

---

## Almindelige problemer

Her er nogle almindelige problemer og hvordan du kan løse dem.

---

### OpenCode vil ikke starte

1. Tjek logfilerne for fejlmeddelelser
2. Prøv at køre med `--print-logs` for at se output i terminalen
3. Sørg for at du har den nyeste version med `opencode upgrade`

---

### Godkendelsesproblemer

1. Prøv at godkende på ny med kommandoen `/connect` i TUI
2. Tjek at dine API-nøgler er gyldige
3. Sørg for at dit netværk tillader forbindelser til udbyderens API

---

### Modellen er ikke tilgængelig

1. Tjek at du har godkendt dig med udbyderen
2. Kontroller at modelnavnet i konfigurationen er rigtigt
3. Nogle modeller kan kræve specifik adgang eller abonnement

Hvis du støder på `ProviderModelNotFoundError` refererer du mest sandsynligt forkert
til en model et sted.
Modeller skal refereres sådan: `<providerId>/<modelId>`

Eksempler:

- `openai/gpt-4.1`
- `openrouter/google/gemini-2.5-flash`
- `opencode/kimi-k2`

For at finde ud af hvilke modeller du har adgang til, kør `opencode models`

---

### ProviderInitError

Hvis du støder på en ProviderInitError, har du sandsynligvis en ugyldig eller ødelagt konfiguration.

For at løse dette:

1. Kontroller først at din udbyder er rigtigt konfigureret ved at følge [udbydervejledningen](/docs/providers)
2. Hvis problemet vedvarer, prøv at tømme den gemte konfiguration:

   ```bash
   rm -rf ~/.local/share/opencode
   ```

   På Windows, tryk `WIN+R` og slet: `%USERPROFILE%\.local\share\opencode`

3. Godkend på ny med din udbyder ved at bruge kommandoen `/connect` i TUI.

---

### AI_APICallError og udbyderpakkeproblemer

Hvis du støder på API-kaldsfejl, kan dette skyldes forældede udbyderpakker. opencode installerer dynamisk udbyderpakker (OpenAI, Anthropic, Google, etc.) efter behov og cacher dem lokalt.

For at løse problemer med udbyderpakke:

1. Tøm udbyderens pakkecache:

   ```bash
   rm -rf ~/.cache/opencode
   ```

   På Windows, tryk `WIN+R` og slet: `%USERPROFILE%\.cache\opencode`

2. Start opencode på ny for at installere de nyeste udbyderpakker på ny

Dette vil tvinge opencode til at downloade de nyeste versioner af udbyderpakkerne, som ofte løser kompatibilitetsproblemer med modelparametre og API-ændringer.

---

### Kopier/indsæt virker ikke på Linux

Linux-brugere skal have et af følgende udklipsholderværktøjer installeret for at kopier/indsæt-funktionalitet skal fungere:

**For X11-systemer:**

```bash
apt install -y xclip
# or
apt install -y xsel
```

**For Wayland-systemer:**

```bash
apt install -y wl-clipboard
```

**For hovedløse miljøer:**

```bash
apt install -y xvfb
# and run:
Xvfb :99 -screen 0 1024x768x24 > /dev/null 2>&1 &
export DISPLAY=:99.0
```

opencode vil opdage om du bruger Wayland og foretrække `wl-clipboard`, ellers vil den prøve at finde udklipsholderværktøjer i rækkefølgen: `xclip` og `xsel`.
