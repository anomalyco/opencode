<p align="center">
  <a href="https://weapon.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="// WEAPON //">
    </picture>
  </a>
</p>
<p align="center">Weapon je open source AI agent za programiranje.</p>
<p align="center">
  <a href="https://weapon.ai/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/weapon-ai"><img alt="npm" src="https://img.shields.io/npm/v/weapon-ai?style=flat-square" /></a>
  <a href="https://github.com/anomalyco/weapon/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/anomalyco/weapon/publish.yml?style=flat-square&branch=dev" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a> |
  <a href="README.zht.md">繁體中文</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.it.md">Italiano</a> |
  <a href="README.da.md">Dansk</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.pl.md">Polski</a> |
  <a href="README.ru.md">Русский</a> |
  <a href="README.bs.md">Bosanski</a> |
  <a href="README.ar.md">العربية</a> |
  <a href="README.no.md">Norsk</a> |
  <a href="README.br.md">Português (Brasil)</a> |
  <a href="README.th.md">ไทย</a> |
  <a href="README.tr.md">Türkçe</a>
</p>

[![Weapon Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://weapon.ai)

---

### Instalacija

```bash
# YOLO
curl -fsSL https://weapon.ai/install | bash

# Package manageri
npm i -g weapon-ai@latest        # ili bun/pnpm/yarn
scoop install weapon             # Windows
choco install weapon             # Windows
brew install anomalyco/tap/weapon # macOS i Linux (preporučeno, uvijek ažurno)
brew install weapon              # macOS i Linux (zvanična brew formula, rjeđe se ažurira)
paru -S weapon-bin               # Arch Linux
mise use -g weapon               # Bilo koji OS
nix run nixpkgs#weapon           # ili github:anomalyco/weapon za najnoviji dev branch
```

> [!TIP]
> Ukloni verzije starije od 0.1.x prije instalacije.

### Desktop aplikacija (BETA)

Weapon je dostupan i kao desktop aplikacija. Preuzmi je direktno sa [stranice izdanja](https://github.com/anomalyco/weapon/releases) ili sa [weapon.ai/download](https://weapon.ai/download).

| Platforma             | Preuzimanje                           |
| --------------------- | ------------------------------------- |
| macOS (Apple Silicon) | `weapon-desktop-darwin-aarch64.dmg` |
| macOS (Intel)         | `weapon-desktop-darwin-x64.dmg`     |
| Windows               | `weapon-desktop-windows-x64.exe`    |
| Linux                 | `.deb`, `.rpm`, ili AppImage          |

```bash
# macOS (Homebrew)
brew install --cask weapon-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/weapon-desktop
```

#### Instalacijski direktorij

Instalacijska skripta koristi sljedeći redoslijed prioriteta za putanju instalacije:

1. `$WEAPON_INSTALL_DIR` - Prilagođeni instalacijski direktorij
2. `$XDG_BIN_DIR` - Putanja usklađena sa XDG Base Directory specifikacijom
3. `$HOME/bin` - Standardni korisnički bin direktorij (ako postoji ili se može kreirati)
4. `$HOME/.weapon/bin` - Podrazumijevana rezervna lokacija

```bash
# Primjeri
WEAPON_INSTALL_DIR=/usr/local/bin curl -fsSL https://weapon.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://weapon.ai/install | bash
```

### Agenti

Weapon uključuje dva ugrađena agenta između kojih možeš prebacivati tasterom `Tab`.

- **build** - Podrazumijevani agent sa punim pristupom za razvoj
- **plan** - Agent samo za čitanje za analizu i istraživanje koda
  - Podrazumijevano zabranjuje izmjene datoteka
  - Traži dozvolu prije pokretanja bash komandi
  - Idealan za istraživanje nepoznatih codebase-ova ili planiranje izmjena

Uključen je i **general** pod-agent za složene pretrage i višekoračne zadatke.
Koristi se interno i može se pozvati pomoću `@general` u porukama.

Saznaj više o [agentima](https://weapon.ai/docs/agents).

### Dokumentacija

Za više informacija o konfiguraciji Weapon-a, [**pogledaj dokumentaciju**](https://weapon.ai/docs).

### Doprinosi

Ako želiš doprinositi Weapon-u, pročitaj [upute za doprinošenje](./CONTRIBUTING.md) prije slanja pull requesta.

### Gradnja na Weapon-u

Ako radiš na projektu koji je povezan s Weapon-om i koristi "weapon" kao dio naziva, npr. "weapon-dashboard" ili "weapon-mobile", dodaj napomenu u svoj README da projekat nije napravio Weapon tim i da nije povezan s nama.

### FAQ

#### Po čemu se razlikuje od Claude Code-a?

Po mogućnostima je vrlo sličan Claude Code-u. Ključne razlike su:

- 100% open source
- Nije vezan za jednog provajdera. Iako preporučujemo modele koje nudimo kroz [Weapon Zen](https://weapon.ai/zen), Weapon možeš koristiti s Claude, OpenAI, Google ili čak lokalnim modelima. Kako modeli napreduju, razlike među njima će se smanjivati, a cijene padati, zato je nezavisnost od provajdera važna.
- LSP podrška odmah po instalaciji
- Fokus na TUI. Weapon grade neovim korisnici i kreatori [terminal.shop](https://terminal.shop); pomjeraćemo granice onoga što je moguće u terminalu.
- Klijent/server arhitektura. To, recimo, omogućava da Weapon radi na tvom računaru dok ga daljinski koristiš iz mobilne aplikacije, što znači da je TUI frontend samo jedan od mogućih klijenata.

---

**Pridruži se našoj zajednici** [Discord](https://discord.gg/weapon) | [X.com](https://x.com/weapon)
