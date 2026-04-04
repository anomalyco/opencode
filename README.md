<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="Logo OpenCode">
    </picture>
  </a>
</p>
<p align="center">Agen coding AI open-source.</p>
<p align="center">
  <a href="https://opencode.ai/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/opencode-ai"><img alt="npm" src="https://img.shields.io/npm/v/opencode-ai?style=flat-square" /></a>
  <a href="https://github.com/anomalyco/opencode/actions/workflows/publish.yml"><img alt="Status build" src="https://img.shields.io/github/actions/workflow/status/anomalyco/opencode/publish.yml?style=flat-square&branch=dev" /></a>
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
  <a href="README.id.md">Bahasa Indonesia</a>
</p>

[![Antarmuka Terminal OpenCode](packages/web/src/assets/lander/screenshot.png)](https://opencode.ai)

---

### Instalasi

```bash
# YOLO
curl -fsSL https://opencode.ai/install | bash

# Package manager
npm i -g opencode-ai@latest        # atau bun/pnpm/yarn
scoop install opencode             # Windows
choco install opencode             # Windows
brew install anomalyco/tap/opencode # macOS dan Linux (direkomendasikan, selalu up-to-date)
brew install opencode              # macOS dan Linux (formula brew resmi, update lebih jarang)
sudo pacman -S opencode            # Arch Linux (Stable)
paru -S opencode-bin               # Arch Linux (Latest dari AUR)
mise use -g opencode               # Semua OS
nix run nixpkgs#opencode           # atau github:anomalyco/opencode untuk branch dev terbaru
```

> [!TIP]
> Hapus versi lama di bawah 0.1.x sebelum install.

### Desktop App (BETA)

OpenCode juga tersedia sebagai desktop app. Download langsung dari [halaman releases](https://github.com/anomalyco/opencode/releases) atau [opencode.ai/download](https://opencode.ai/download).

| Platform              | Download                              |
| --------------------- | ------------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-darwin-aarch64.dmg` |
| macOS (Intel)         | `opencode-desktop-darwin-x64.dmg`     |
| Windows               | `opencode-desktop-windows-x64.exe`    |
| Linux                 | `.deb`, `.rpm`, atau AppImage         |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop
```

#### Installation Directory

Install script mengikuti urutan prioritas berikut untuk menentukan path instalasi:

1. `$OPENCODE_INSTALL_DIR` - Custom installation directory
2. `$XDG_BIN_DIR` - Path sesuai XDG Base Directory Specification
3. `$HOME/bin` - Standard user binary directory (jika sudah ada atau bisa dibuat)
4. `$HOME/.opencode/bin` - Default fallback

```bash
# Contoh
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### Agents

OpenCode punya dua built-in agent, bisa diganti dengan `Tab`.

- **build** - Agent default dengan full access untuk development
- **plan** - Agent read-only untuk analisis dan eksplorasi kode
  - Menolak file edit secara default
  - Minta permission sebelum menjalankan command bash
  - Ideal untuk explore codebase yang belum dikenal atau merencanakan perubahan

Tersedia juga subagent **general** untuk pencarian kompleks dan tugas multi-step.
Digunakan secara internal dan bisa dipanggil dengan `@general` dalam pesan.

Pelajari lebih lanjut tentang [agents](https://opencode.ai/docs/agents).

### Dokumentasi

Untuk info lebih lanjut cara config OpenCode, [**kunjungi dokumentasi kami**](https://opencode.ai/docs).

### Berkontribusi

Tertarik berkontribusi ke OpenCode? Baca dulu [panduan kontribusi](./CONTRIBUTING.md) sebelum submit pull request.

### Membangun di Atas OpenCode

Jika sedang mengerjakan project yang berkaitan dengan OpenCode dan menggunakan "opencode" sebagai bagian dari namanya — misalnya "opencode-dashboard" atau "opencode-mobile" — tambahkan catatan di README untuk menjelaskan bahwa project tersebut bukan buatan tim OpenCode dan tidak berafiliasi dengan kami.

### FAQ

#### Apa bedanya dengan Claude Code?

Secara kapabilitas sangat mirip dengan Claude Code. Berikut perbedaan utamanya:

- 100% open source
- Tidak terikat ke provider tertentu. Meski kami merekomendasikan model yang tersedia lewat [OpenCode Zen](https://opencode.ai/zen), OpenCode bisa dipakai dengan Claude, OpenAI, Google, atau bahkan model lokal. Seiring model berkembang, gap antar model akan menyempit dan harga akan turun — jadi provider-agnostic itu penting.
- Out-of-the-box LSP support
- Fokus pada TUI. OpenCode dibuat oleh pengguna neovim dan kreator [terminal.shop](https://terminal.shop); kami akan terus mendorong batas kemungkinan di dalam terminal.
- Arsitektur client/server. Ini memungkinkan OpenCode berjalan di komputer lokal sambil dikendalikan dari jarak jauh lewat mobile app — artinya TUI frontend hanyalah salah satu dari banyak kemungkinan client.

---

**Bergabung ke komunitas kami** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
