<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center">Адкрыты AI-агент для кадавання з адкрытым зыходным кодам.</p>
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

### Усталяванне

```bash
# YOLO
curl -fsSL https://opencode.ai/install | bash

# Менеджары пакетаў
npm i -g opencode-ai@latest        # або bun/pnpm/yarn
scoop install opencode             # Windows
choco install opencode             # Windows
brew install anomalyco/tap/opencode # macOS і Linux (рэкамендуецца, заўсёды актуальная версія)
brew install opencode              # macOS і Linux (афіцыйная формула brew, абнаўляецца радзей)
sudo pacman -S opencode            # Arch Linux (Stable)
paru -S opencode-bin               # Arch Linux (Апошняя версія з AUR)
mise use -g opencode               # Любая АС
nix run nixpkgs#opencode           # або github:anomalyco/opencode для апошняй dev галіны
```

> [!TIP]
> Выдаліце версіі старэйшыя за 0.1.x перад усталяваннем.

### Настольнае прыкладанне (BETA)

OpenCode таксама даступны як настольнае прыкладанне. Спампуйце непасрэдна са [старонкі рэлізаў](https://github.com/anomalyco/opencode/releases) або [opencode.ai/download](https://opencode.ai/download).

| Платформа             | Спампаваць                         |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `opencode-desktop-mac-x64.dmg`     |
| Windows               | `opencode-desktop-windows-x64.exe` |
| Linux                 | `.deb`, `.rpm`, або `.AppImage`    |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop
```

#### Каталог усталявання

Скрыпт усталявання прытрымліваецца наступнага парадку прыярытэтаў для шляху ўсталявання:

1. `$OPENCODE_INSTALL_DIR` - Карыстальніцкі каталог усталявання
2. `$XDG_BIN_DIR` - Шлях, які адпавядае спецыфікацыі XDG Base Directory
3. `$HOME/bin` - Стандартны каталог карыстальніцкіх бінарных файлаў (калі ён існуе або можа быць створаны)
4. `$HOME/.opencode/bin` - Стандартны рэзервовы варыянт

```bash
# Прыклады
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### Агенты

OpenCode уключае два ўбудаваныя агенты, паміж якімі можна пераключацца клавішай `Tab`.

- **build** - Стандартны агент з поўным доступам для распрацоўчай працы
- **plan** - Агент толькі для чытання для аналізу і даследавання кода
  - Па змаўчанні забараняе рэдагаванне файлаў
  - Запытвае дазвол перад выкананнем bash-каманд
  - Ідэальна падыходзіць для даследавання незнаёмых кодавых баз або планавання змен

Таксама ўключаны субагент **general** для складаных пошукаў і шматэтапных задач.
Ён выкарыстоўваецца ўнутрана і можа быць выкліканы з дапамогай `@general` у паведамленнях.

Даведайцеся больш пра [агентаў](https://opencode.ai/docs/agents).

### Дакументацыя

Для атрымання дадатковай інфармацыі пра тое, як наладзіць OpenCode, [**наведайце нашу дакументацыю**](https://opencode.ai/docs).

### Унёсак у развіццё

Калі вы зацікаўлены ва ўнёску ў развіццё OpenCode, калі ласка, азнаёмцеся з нашай [дакументацыяй для ўдзельнікаў](./CONTRIBUTING.md) перад адпраўкай pull request.

### Распрацоўка на аснове OpenCode

Калі вы працуеце над праектам, які звязаны з OpenCode і выкарыстоўвае "opencode" як частку сваёй назвы, напрыклад "opencode-dashboard" або "opencode-mobile", калі ласка, дадайце заўвагу ў свой README, каб удакладніць, што ён не створаны камандай OpenCode і ніяк не звязаны з намі.

---

**Далучайцеся да нашай супольнасці** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
