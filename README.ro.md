<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="Logo OpenCode">
    </picture>
  </a>
</p>

<p align="center">Agentul AI open-source pentru programare.</p>

<p align="center">
  <a href="https://opencode.ai/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/opencode-ai"><img alt="npm" src="https://img.shields.io/npm/v/opencode-ai?style=flat-square" /></a>
  <a href="https://github.com/anomalyco/opencode/actions/workflows/publish.yml"><img alt="Status build" src="https://img.shields.io/github/actions/workflow/status/anomalyco/opencode/publish.yml?style=flat-square&branch=dev" /></a>
</p>

<p align="center">
  <a href="README.md">Engleză</a> |
  <a href="README.zh.md">Chineză Simplificată</a> |
  <a href="README.zht.md">Chineză Tradițională</a> |
  <a href="README.ko.md">Coreeană</a> |
  <a href="README.de.md">Germană</a> |
  <a href="README.es.md">Spaniolă</a> |
  <a href="README.fr.md">Franceză</a> |
  <a href="README.it.md">Italiană</a> |
  <a href="README.da.md">Daneză</a> |
  <a href="README.ja.md">Japoneză</a> |
  <a href="README.pl.md">Poloneză</a> |
  <a href="README.ru.md">Rusă</a> |
  <a href="README.bs.md">Bosniacă</a> |
  <a href="README.ar.md">Arabă</a> |
  <a href="README.no.md">Norvegiană</a> |
  <a href="README.br.md">Portugheză (Brazilia)</a> |
  <a href="README.th.md">Thailandeză</a> |
  <a href="README.tr.md">Turcă</a> |
  <a href="README.uk.md">Ucraineană</a> |
  <a href="README.bn.md">Bengaleză</a> |
  <a href="README.gr.md">Greacă</a> |
  <a href="README.vi.md">Vietnameză</a>
</p>

[![Interfața Terminal OpenCode](packages/web/src/assets/lander/screenshot.png)](https://opencode.ai)

---

### Instalare

```bash
# YOLO
curl -fsSL https://opencode.ai/install | bash

# Manageri de pachete
npm i -g opencode-ai@latest        # sau bun/pnpm/yarn
scoop install opencode             # Windows
choco install opencode             # Windows
brew install anomalyco/tap/opencode # macOS și Linux (recomandat, mereu actualizat)
brew install opencode              # macOS și Linux (formula oficială brew, actualizată mai rar)
sudo pacman -S opencode            # Arch Linux (Stabil)
paru -S opencode-bin               # Arch Linux (Ultima versiune din AUR)
mise use -g opencode               # Orice sistem de operare
nix run nixpkgs#opencode           # sau github:anomalyco/opencode pentru ultima ramură dev
```

> [!TIP]
> Elimină versiunile mai vechi de 0.1.x înainte de instalare.

### Aplicație Desktop (BETA)

OpenCode este disponibil și ca aplicație desktop. Descarcă direct de pe pagina de release-uri sau de pe opencode.ai/download.

| Platformă            | Descărcare                         |
| -------------------- | ---------------------------------- |
| macOS (Apple Silicon)| `opencode-desktop-mac-arm64.dmg`   |
| macOS (Intel)        | `opencode-desktop-mac-x64.dmg`     |
| Windows              | `opencode-desktop-windows-x64.exe` |
| Linux                | `.deb`, `.rpm` sau `.AppImage`     |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop

# Windows (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop
```

#### Director de Instalare

Scriptul de instalare respectă următoarea ordine de prioritate pentru locația instalării:

1. `$OPENCODE_INSTALL_DIR` - Director personalizat de instalare
2. `$XDG_BIN_DIR` - Cale compatibilă cu specificația XDG Base Directory
3. `$HOME/bin` - Director standard pentru binare utilizator (dacă există sau poate fi creat)
4. `$HOME/.opencode/bin` - Varianta implicită de rezervă

```bash
# Exemple
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### Agenți

OpenCode include doi agenți integrați între care poți comuta folosind tasta `Tab`.

- **build** - Agent implicit, cu acces complet pentru dezvoltare
- **plan** - Agent doar pentru citire, destinat analizei și explorării codului
  - Blochează modificările fișierelor în mod implicit
  - Cere permisiune înainte de a rula comenzi bash
  - Ideal pentru explorarea codebase-urilor necunoscute sau planificarea modificărilor

Este inclus și un subagent **general** pentru căutări complexe și task-uri în mai mulți pași.
Acesta este folosit intern și poate fi apelat folosind `@general` în mesaje.

Află mai multe despre agenți.

### Documentație

Pentru mai multe informații despre configurarea OpenCode, intră pe documentația noastră.

### Contribuții

Dacă vrei să contribui la OpenCode, citește documentația noastră despre contribuții din `CONTRIBUTING.md` înainte de a trimite un pull request.

### Construind pe baza OpenCode

Dacă lucrezi la un proiect legat de OpenCode și folosești „opencode” ca parte din nume, de exemplu „opencode-dashboard” sau „opencode-mobile”, te rugăm să adaugi o notă în README pentru a clarifica faptul că proiectul nu este realizat de echipa OpenCode și nu este afiliat cu noi în niciun fel.

---

**Alătură-te comunității noastre** Discord | X.com
