<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center">Open source AI agent pro psaní kódu.</p>
<p align="center">
  <a href="https://opencode.ai/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/opencode-ai"><img alt="npm" src="https://img.shields.io/npm/v/opencode-ai?style=flat-square" /></a>
  <a href="https://github.com/anomalyco/opencode/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/anomalyco/opencode/publish.yml?style=flat-square&branch=dev" /></a>
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
  <a href="README.cs.md">Čeština</a> |
  <a href="README.ar.md">العربية</a> |
  <a href="README.no.md">Norsk</a> |
  <a href="README.br.md">Português (Brasil)</a> |
  <a href="README.th.md">ไทย</a> |
  <a href="README.tr.md">Türkçe</a> |
  <a href="README.uk.md">Українська</a> |
  <a href="README.bn.md">বাংলা</a> |
  <a href="README.gr.md">Ελληνικά</a> |
  <a href="README.vi.md">Tiếng Việt</a>
</p>

[![OpenCode Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://opencode.ai)

---

### Instalace

```bash
# YOLO
curl -fsSL https://opencode.ai/install | bash

# Správci balíčků
npm i -g opencode-ai@latest        # nebo bun/pnpm/yarn
scoop install opencode             # Windows
choco install opencode             # Windows
brew install anomalyco/tap/opencode # macOS a Linux (doporučeno, vždy aktuální)
brew install opencode              # macOS a Linux (oficiální brew formula, méně časté aktualizace)
sudo pacman -S opencode            # Arch Linux (stabilní verze)
paru -S opencode-bin               # Arch Linux (nejnovější z AUR)
mise use -g opencode               # Libovolný OS
nix run nixpkgs#opencode           # nebo github:anomalyco/opencode pro nejnovější dev branch
```

> [!TIP]
> Před instalací odeberte verze starší než 0.1.x.

### Desktopová aplikace (BETA)

OpenCode je dostupný také jako desktopová aplikace. Stáhněte ji přímo ze stránky [releases](https://github.com/anomalyco/opencode/releases) nebo z [opencode.ai/download](https://opencode.ai/download).

| Platforma             | Stažení                               |
| --------------------- | ------------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-darwin-aarch64.dmg` |
| macOS (Intel)         | `opencode-desktop-darwin-x64.dmg`     |
| Windows               | `opencode-desktop-windows-x64.exe`    |
| Linux                 | `.deb`, `.rpm` nebo AppImage          |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop
```

#### Instalační adresář

Instalační skript respektuje následující pořadí priorit pro instalační cestu:

1. `$OPENCODE_INSTALL_DIR` - Vlastní instalační adresář
2. `$XDG_BIN_DIR` - Cesta kompatibilní se specifikací XDG Base Directory
3. `$HOME/bin` - Standardní uživatelský adresář pro binárky (pokud existuje nebo jej lze vytvořit)
4. `$HOME/.opencode/bin` - Výchozí náhradní umístění

```bash
# Příklady
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### Agenti

OpenCode obsahuje dva vestavěné agenty, mezi kterými můžete přepínat klávesou `Tab`.

- **build** - Výchozí agent s plným přístupem pro vývojovou práci
- **plan** - Agent jen pro čtení určený k analýze a průzkumu kódu
  - Ve výchozím nastavení odmítá úpravy souborů
  - Před spuštěním bash příkazů žádá o povolení
  - Hodí se pro průzkum neznámého kódu nebo plánování změn

Součástí je také subagent **general** pro složité vyhledávání a vícekrokové úlohy.
Používá se interně a ve zprávách jej lze vyvolat pomocí `@general`.

Více se dozvíte v dokumentaci k [agentům](https://opencode.ai/docs/agents).

### Dokumentace

Více informací o konfiguraci OpenCode najdete v [**naší dokumentaci**](https://opencode.ai/docs).

### Přispívání

Pokud chcete do OpenCode přispívat, před odesláním pull requestu si přečtěte [pokyny pro přispívání](./CONTRIBUTING.md).

### Projekty postavené nad OpenCode

Pokud pracujete na projektu souvisejícím s OpenCode a používáte "opencode" jako součást názvu, například "opencode-dashboard" nebo "opencode-mobile", přidejte do svého README poznámku, že projekt nevytváří tým OpenCode a není s námi nijak spojený.

### FAQ

#### Jak se to liší od Claude Code?

Schopnostmi je to velmi podobné Claude Code. Hlavní rozdíly:

- 100% open source
- Není svázaný s žádným poskytovatelem. Doporučujeme sice modely, které nabízíme přes [OpenCode Zen](https://opencode.ai/zen), ale OpenCode lze používat s Claude, OpenAI, Google i lokálními modely. Jak se modely vyvíjejí, rozdíly mezi nimi se budou zmenšovat a ceny klesat, takže nezávislost na poskytovateli je důležitá.
- Podpora LSP hned po instalaci
- Důraz na TUI. OpenCode staví uživatelé neovimu a tvůrci [terminal.shop](https://terminal.shop); chceme posouvat hranice toho, co je v terminálu možné.
- Architektura klient/server. Díky tomu může OpenCode běžet například na vašem počítači, zatímco jej vzdáleně ovládáte z mobilní aplikace, takže TUI frontend je jen jeden z možných klientů.

---

**Připojte se k naší komunitě** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
