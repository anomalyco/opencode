---
title: Feilsøking
description: Vanlige problemer og hvordan de kan løses.
---

For å feilsøke problemer med OpenCode, start med å sjekke loggene og lokale data den lagrer på disken.

---

## Logger

Loggfiler skrives til:

- **macOS/Linux**: `~/.local/share/opencode/log/`
- **Windows**: Trykk `WIN+R` og lim inn `%USERPROFILE%\.local\share\opencode\log`

Loggfiler navngis med tidsstempler (f.eks. `2025-01-09T123456.log`) og de siste 10 loggfilene beholdes.

Du kan angi loggnivået med kommandolinjealternativet `--log-level` for å få mer detaljert feilsøkingsinformasjon. For eksempel `opencode --log-level DEBUG`.

---

## Lagring

OpenCode lagrer øktdata og andre applikasjonsdata på disken på:

- **macOS/Linux**: `~/.local/share/opencode/`
- **Windows**: Trykk `WIN+R` og lim inn `%USERPROFILE%\.local\share\opencode`

Denne katalogen inneholder:

- `auth.json` - Autentiseringsdata som API-nøkler, OAuth-tokens
- `log/` - Applikasjonslogger
- `project/` - Prosjektspesifikke data som økt- og meldingsdata
  - Hvis prosjektet er innenfor en Git-repo, lagres det i `./<project-slug>/storage/`
  - Hvis det ikke er en Git-repo, lagres det i `./global/storage/`

---

## Skrivebordsapp

OpenCode Desktop kjører en lokal OpenCode-server (`opencode-cli` sidevognen) i bakgrunnen. De fleste problemene er forårsaket av en plugin som fungerer dårlig, en ødelagt cache eller en dårlig serverinnstilling.

### Raske sjekker

- Avslutt og start appen på nytt.
- Hvis appen viser en feilskjerm, klikker du på **Start på nytt** og kopierer feildetaljene.
- Bare macOS: `OpenCode`-meny -> **Last nettvisning på nytt** (hjelper hvis UI er tom/frosset).

---

### Deaktiver plugins

Hvis skrivebordsappen krasjer ved oppstart, henger eller oppfører seg merkelig, start med å deaktivere plugins.

#### Sjekk den globale konfigurasjonen

Åpne den globale konfigurasjonsfilen og se etter en `plugin`-nøkkel.

- **macOS/Linux**: `~/.config/opencode/opencode.jsonc` (eller `~/.config/opencode/opencode.json`)
- **macOS/Linux** (eldre installasjoner): `~/.local/share/opencode/opencode.jsonc`
- **Windows**: Trykk `WIN+R` og lim inn `%USERPROFILE%\.config\opencode\opencode.jsonc`

Hvis du har konfigurert plugins, deaktiver dem midlertidig ved å fjerne nøkkelen eller sette den til en tom matrise:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [],
}
```

#### Sjekk plugin-kataloger

OpenCode kan også laste lokale plugins fra disken. Flytt disse midlertidig ut av veien (eller gi nytt navn til mappen) og start skrivebordsappen på nytt:

- **Globale plugins**
  - **macOS/Linux**: `~/.config/opencode/plugins/`
  - **Windows**: Trykk `WIN+R` og lim inn `%USERPROFILE%\.config\opencode\plugins`
- **Prosjektplugins** (bare hvis du bruker konfigurasjon per prosjekt)
  - `<your-project>/.opencode/plugins/`

Hvis appen begynner å fungere igjen, aktiverer du plugins én om gangen for å finne ut hvilken som forårsaker problemet.

---

### Tøm hurtigbufferen

Hvis deaktivering av plugins ikke hjelper (eller en plugin-installasjon sitter fast), tøm hurtigbufferen slik at OpenCode kan gjenoppbygge den.

1. Avslutt OpenCode Desktop helt.
2. Slett hurtigbufferkatalogen:

- **macOS**: Finder -> `Cmd+Shift+G` -> lim inn `~/.cache/opencode`
- **Linux**: slett `~/.cache/opencode` (eller kjør `rm -rf ~/.cache/opencode`)
- **Windows**: Trykk `WIN+R` og lim inn `%USERPROFILE%\.cache\opencode`

3. Start OpenCode Desktop på nytt.

---

### Løs problemer med servertilkobling

OpenCode Desktop kan enten starte sin egen lokale server (standard) eller koble til en server URL du har konfigurert.

Hvis du ser en **"Tilkobling mislyktes"**-dialogboks (eller appen kommer aldri forbi splash-skjermen), se etter en tilpasset server URL.

#### Slett skrivebordsappens standardserver-URL

Fra startskjermen klikker du på servernavnet (med statusprikken) for å åpne servervelgeren. I delen **Standardserver** klikker du på **Slett**.

#### Fjern `server.port` / `server.hostname` fra konfigurasjonen din

Hvis `opencode.json(c)` inneholder en `server`-del, fjern den midlertidig og start skrivebordsappen på nytt.

#### Sjekk miljøvariabler

Hvis du har `OPENCODE_PORT` satt i miljøet ditt, vil skrivebordsappen prøve å bruke den porten for den lokale serveren.

- Deaktiver `OPENCODE_PORT` (eller velg en ledig port) og start på nytt.

---

### Linux: Wayland / X11 problemer

På Linux kan noen Wayland-oppsett forårsake tomme vinduer eller kompositorfeil.

- Hvis du er på Wayland og appen er tom/krasj, prøv å starte med `OC_ALLOW_WAYLAND=1`.
- Hvis det gjør ting verre, fjern det og prøv å starte under en X11-økt i stedet.

---

### Windows: WebView2 kjøretid

På Windows krever OpenCode Desktop Microsoft Edge **WebView2 Runtime**. Hvis appen åpnes i et tomt vindu eller ikke starter, installer/oppdater WebView2 og prøv igjen.

---

### Windows: Generelle ytelsesproblemer

Hvis du opplever treg ytelse, problemer med filtilgang eller terminalproblemer på Windows, kan du prøve å bruke [WSL (Windows Subsystem for Linux)](/docs/windows-wsl). WSL gir et Linux-miljø som fungerer mer sømløst med funksjonene til OpenCode.

---

### Varsler vises ikke

OpenCode Desktop viser bare systemvarsler når:

- varsler er aktivert for OpenCode i OS-innstillingene dine, og
- appvinduet er ikke fokusert.

---

### Tilbakestill skrivebordsapplagring (siste utvei)

Hvis appen ikke starter og du ikke kan slette innstillingene fra UI-et, tilbakestill skrivebordsappens lagrede tilstand.

1. Avslutt OpenCode Desktop.
2. Finn og slett disse filene (de finnes i OpenCode Desktop-appens datakatalog):

- `opencode.settings.dat` (stasjonær standardserver URL)
- `opencode.global.dat` og `opencode.workspace.*.dat` (UI tilstand som nylige servere/prosjekter)

---

### Modellen er ikke tilgjengelig

1. Sjekk at du har autentisert deg med leverandøren
2. Kontroller at modellnavnet i konfigurasjonen er riktig
3. Noen modeller kan kreve spesifikk tilgang eller abonnement

Hvis du støter på `ProviderModelNotFoundError` refererer du mest sannsynlig feil
til en modell et sted.
Modeller skal refereres slik: `<providerId>/<modelId>`

---

### AI_APICallError og leverandørpakkeproblemer

Hvis du støter på API-anropsfeil, kan dette skyldes utdaterte provider-pakker. OpenCode installerer dynamisk provider-pakker (OpenAI, Anthropic, Google, etc.) etter behov og cacher dem lokalt.

For å løse problemer med leverandørpakke:

1. Tøm leverandørens pakkebuffer:

   ```bash
   rm -rf ~/.cache/opencode
   ```

   På Windows, trykk `WIN+R` og slett: `%USERPROFILE%\.cache\opencode`

2. Start OpenCode på nytt for å installere de nyeste provider-pakkene på nytt

Dette vil tvinge OpenCode til å laste ned de nyeste versjonene av provider-pakkene, som ofte løser kompatibilitetsproblemer med modellparametere og API-endringer.

---

### Kopier/lim inn fungerer ikke på Linux

Linux-brukere må ha ett av følgende utklippstavle-verktøy installert for at kopier/lim inn-funksjonalitet skal fungere:

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

**For headless-miljøer:**

```bash
apt install -y xvfb
# and run:
Xvfb :99 -screen 0 1024x768x24 > /dev/null 2>&1 &
export DISPLAY=:99.0
```

OpenCode vil oppdage om du bruker Wayland og foretrekker `wl-clipboard`, ellers vil den prøve å finne utklippstavle-verktøy i rekkefølgen: `xclip` og `xsel`.
