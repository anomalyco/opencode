<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center">Ochiq kodli sun'iy intellekt dasturlash agenti.</p>
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
  <a href="README.vi.md">Tiếng Việt</a> |
  <a href="README.uz.md">O'zbekcha</a>
</p>

[![OpenCode Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://opencode.ai)

---

### O'rnatish

```bash
# YOLO
curl -fsSL https://opencode.ai/install | bash

# Paket menejerlari
npm i -g opencode-ai@latest        # yoki bun/pnpm/yarn
scoop install opencode             # Windows
choco install opencode             # Windows
brew install anomalyco/tap/opencode # macOS va Linux (tavsiya etiladi, doim yangilanib turadi)
brew install opencode              # macOS va Linux (rasmiy brew formulasi, kamroq yangilanadi)
sudo pacman -S opencode            # Arch Linux (Barqaror)
paru -S opencode-bin               # Arch Linux (AUR'dan eng so'nggi versiya)
mise use -g opencode               # Har qanday OS uchun
nix run nixpkgs#opencode           # yoki eng so'nggi dev tarmog'i uchun github:anomalyco/opencode
```

> [!TIP]
> O'rnatishdan oldin 0.1.x dan eski versiyalarni olib tashlang.

### Desktop ilova (BETA)

OpenCode desktop ilovasi sifatida ham mavjud. To'g'ridan-to'g'ri [relizlar sahifasidan](https://github.com/anomalyco/opencode/releases) yoki [opencode.ai/download](https://opencode.ai/download) manzilidan yuklab oling.

| Platforma             | Yuklab olish                          |
| --------------------- | ------------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-darwin-aarch64.dmg` |
| macOS (Intel)         | `opencode-desktop-darwin-x64.dmg`     |
| Windows               | `opencode-desktop-windows-x64.exe`    |
| Linux                 | `.deb`, `.rpm`, yoki AppImage         |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop
```

#### O'rnatish katalogi

O'rnatish skripti o'rnatish yo'li uchun quyidagi ustuvorlik tartibiga rioya qiladi:

1. `$OPENCODE_INSTALL_DIR` - Maxsus o'rnatish katalogi
2. `$XDG_BIN_DIR` - XDG Base Directory Specification'ga mos yo'l
3. `$HOME/bin` - Standart foydalanuvchi binary katalogi (agar mavjud bo'lsa yoki yaratilishi mumkin bo'lsa)
4. `$HOME/.opencode/bin` - Standart zaxira variant

```bash
# Misollar
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### Agentlar

OpenCode `Tab` tugmasi orqali almashtirish mumkin bo'lgan ikkita ichki agentga ega.

- **build** - Standart, dasturlash ishlari uchun to'liq kirishga ega agent
- **plan** - Tahlil va kodni o'rganish uchun faqat o'qish rejimidagi agent
  - Standart holda fayllarni tahrirlashni rad etadi
  - Bash buyruqlarini bajarishdan oldin ruxsat so'raydi
  - Notanish kod bazalarini o'rganish yoki o'zgarishlarni rejalashtirish uchun ideal

Shuningdek, murakkab qidiruvlar va ko'p bosqichli vazifalar uchun **general** nomli subagent mavjud.
U ichki tarzda ishlatiladi va xabarlarda `@general` orqali chaqirilishi mumkin.

[Agentlar](https://opencode.ai/docs/agents) haqida ko'proq ma'lumot oling.

### Hujjatlar

OpenCode'ni qanday sozlash haqida batafsil ma'lumot olish uchun [**hujjatlarimizni o'qing**](https://opencode.ai/docs).

### Hissa qo'shish

Agar OpenCode'ga hissa qo'shmoqchi bo'lsangiz, pull request yuborishdan oldin [hissa qo'shish hujjatlarini](./CONTRIBUTING.md) o'qing.

### OpenCode asosida loyiha yaratish

Agar siz OpenCode bilan bog'liq loyiha ustida ishlayotgan bo'lsangiz va loyiha nomida "opencode" so'zidan foydalansangiz (masalan, "opencode-dashboard" yoki "opencode-mobile"), iltimos README faylingizga loyiha OpenCode jamoasi tomonidan ishlab chiqilmaganligi va biz bilan hech qanday aloqasi yo'qligini tushuntiruvchi eslatma qo'shing.

### Ko'p beriladigan savollar

#### Bu Claude Code'dan qanday farq qiladi?

Imkoniyatlar jihatidan Claude Code'ga juda o'xshash. Asosiy farqlar:

- 100% ochiq kodli
- Hech qanday provayderga bog'liq emas. Garchi [OpenCode Zen](https://opencode.ai/zen) orqali taqdim etadigan modellarni tavsiya qilsak ham, OpenCode'ni Claude, OpenAI, Google yoki hatto mahalliy modellar bilan ishlatish mumkin. Modellar rivojlangan sari ular orasidagi farq kamayadi va narxlar pasayadi, shuning uchun provayderdan mustaqil bo'lish muhim.
- Qutidan chiqishi bilanoq LSP qo'llab-quvvatlashi
- TUI ga e'tibor qaratish. OpenCode neovim foydalanuvchilari va [terminal.shop](https://terminal.shop) yaratuvchilari tomonidan ishlab chiqilmoqda; biz terminalda mumkin bo'lgan narsalar chegarasini kengaytirmoqchimiz.
- Klient/server arxitekturasi. Bu, masalan, OpenCode'ni kompyuteringizda ishlatib, uni masofadan mobil ilova orqali boshqarish imkonini beradi, ya'ni TUI frontend faqat mumkin bo'lgan klientlardan biridir.

---

**Hamjamiyatimizga qo'shiling** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
