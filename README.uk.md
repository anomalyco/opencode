<p align="center">
  <a href="https://daemonprotocol.com">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="Daemon Protocol logo">
    </picture>
  </a>
</p>
<p align="center">AI-агент для програмування з відкритим кодом.</p>
<p align="center">
  <a href="https://daemonprotocol.com/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/daemoncode"><img alt="npm" src="https://img.shields.io/npm/v/daemoncode?style=flat-square" /></a>
  <a href="https://github.com/daemon-blockint-tech/daemoncode/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/daemon-blockint-tech/daemoncode/publish.yml?style=flat-square&branch=dev" /></a>
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

[![Daemon Protocol Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://daemonprotocol.com)

---

### Встановлення

```bash
# YOLO
curl -fsSL https://daemonprotocol.com/install | bash

# Менеджери пакетів
npm i -g daemoncode@latest        # або bun/pnpm/yarn
scoop install daemoncode             # Windows
choco install daemoncode             # Windows
brew install daemon-blockint-tech/tap/daemoncode # macOS і Linux (рекомендовано, завжди актуально)
brew install daemoncode              # macOS і Linux (офіційна формула Homebrew, оновлюється рідше)
sudo pacman -S daemoncode            # Arch Linux (Stable)
paru -S daemoncode-bin               # Arch Linux (Latest from AUR)
mise use -g daemoncode               # Будь-яка ОС
nix run nixpkgs#daemoncode           # або github:daemon-blockint-tech/daemoncode для найновішої dev-гілки
```

> [!TIP]
> Перед встановленням видаліть версії старші за 0.1.x.

### Десктопний застосунок (BETA)

Daemon Protocol також доступний як десктопний застосунок. Завантажуйте напряму зі [сторінки релізів](https://github.com/daemon-blockint-tech/daemoncode/releases) або [daemonprotocol.com/download](https://daemonprotocol.com/download).

| Платформа             | Завантаження                       |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `daemoncode-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `daemoncode-desktop-mac-x64.dmg`     |
| Windows               | `daemoncode-desktop-windows-x64.exe` |
| Linux                 | `.deb`, `.rpm` або AppImage        |

```bash
# macOS (Homebrew)
brew install --cask daemoncode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/daemoncode-desktop
```

#### Каталог встановлення

Скрипт встановлення дотримується такого порядку пріоритету для шляху встановлення:

1. `$OPENCODE_INSTALL_DIR` - Користувацький каталог встановлення
2. `$XDG_BIN_DIR` - Шлях, сумісний зі специфікацією XDG Base Directory
3. `$HOME/bin` - Стандартний каталог користувацьких бінарників (якщо існує або його можна створити)
4. `$HOME/.opencode/bin` - Резервний варіант за замовчуванням

```bash
# Приклади
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://daemonprotocol.com/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://daemonprotocol.com/install | bash
```

### Агенти

Daemon Protocol містить два вбудовані агенти, між якими можна перемикатися клавішею `Tab`.

- **build** - Агент за замовчуванням із повним доступом для завдань розробки
- **plan** - Агент лише для читання для аналізу та дослідження коду
  - За замовчуванням забороняє редагування файлів
  - Запитує дозвіл перед запуском bash-команд
  - Ідеально підходить для дослідження незнайомих кодових баз або планування змін

Також доступний допоміжний агент **general** для складного пошуку та багатокрокових завдань.
Він використовується всередині системи й може бути викликаний у повідомленнях через `@general`.

Дізнайтеся більше про [agents](https://daemonprotocol.com/docs/agents).

### Документація

Щоб дізнатися більше про налаштування Daemon Protocol, [**перейдіть до нашої документації**](https://daemonprotocol.com/docs).

### Внесок

Якщо ви хочете зробити внесок в Daemon Protocol, будь ласка, прочитайте нашу [документацію для контриб'юторів](./CONTRIBUTING.md) перед надсиланням pull request.

### Проєкти на базі Daemon Protocol

Якщо ви працюєте над проєктом, пов'язаним з Daemon Protocol, і використовуєте "opencode" у назві, наприклад "opencode-dashboard" або "opencode-mobile", додайте примітку до свого README.
Уточніть, що цей проєкт не створений командою Daemon Protocol і жодним чином не афілійований із нами.

---

**Приєднуйтеся до нашої спільноти** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
