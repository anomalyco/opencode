<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center">Agen coding AI Open Source.</p>
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
  <a href="README.id.md">Bahasa Indonesia</a> |
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

### Instalasi

```bash
# YOLO
curl -fsSL https://opencode.ai/install | bash

# Package managers
npm i -g opencode-ai@latest        # atau bun/pnpm/yarn
scoop install opencode             # Windows
choco install opencode             # Windows
brew install anomalyco/tap/opencode # macOS and Linux (disarankan, selalu terbaru)
brew install opencode              # macOS and Linux
sudo pacman -S opencode            # Arch Linux (Stable)
paru -S opencode-bin               # Arch Linux (Latest from AUR)
mise use -g opencode               # Any OS
nix run nixpkgs#opencode           # or github:anomalyco/opencode untuk dev branch terbaru
```

> [!TIP]
> Hapus versi yang lebih lama dari 0.1.x sebelum menginstal.

### Desktop App (BETA)

OpenCode juga tersedia sebagai aplikasi desktop. Unduh langsung dari [halaman rilis](https://github.com/anomalyco/opencode/releases) atau [opencode.ai/download](https://opencode.ai/download).

| Platform              | Unduhan                            |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `opencode-desktop-mac-x64.dmg`     |
| Windows               | `opencode-desktop-windows-x64.exe` |
| Linux                 | `.deb`, `.rpm`, or `.AppImage`     |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop
```

#### Direktori Instalasi

Skrip instalasi mengikuti urutan prioritas berikut untuk lokasi instalasi:

1. `$OPENCODE_INSTALL_DIR` - Custom installation directory
2. `$XDG_BIN_DIR` - XDG Base Directory Specification compliant path
3. `$HOME/bin` - Standard user binary directory (if it exists or can be created)
4. `$HOME/.opencode/bin` - Default fallback

```bash
# Examples
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### Agents

OpenCode menyertakan dua agent bawaan yang dapat Anda ganti dengan tombol `Tab`.

- **build** - Agen default dengan akses penuh untuk pekerjaan development
- **plan** - Agen read-only untuk analisis dan eksplorasi kode
  - Menolak pengeditan file secara default
  - Meminta izin sebelum menjalankan perintah bash
  - Ideal untuk menjelajahi basis kode yang tidak familiar atau merencanakan perubahan

Selain itu, tersedia subagen **general** untuk pencarian kompleks dan tugas "multi-step".
Ini digunakan secara internal dan dapat dipanggil menggunakan `@general` dalam pesan.

Pelajari lebih lanjut tentang [agents](https://opencode.ai/docs/agents).

### Dokumentasi

Untuk informasi lebih lanjut tentang cara mengonfigurasi OpenCode [**kunjungi dokumentasi kami**](https://opencode.ai/docs).

### Kontribusi

Jika Anda tertarik untuk berkontribusi pada OpenCode, silakan baca [dokumen kontribusi kami](./CONTRIBUTING.md) sebelum mengirimkan pull request.

### Membangun di Atas OpenCode

Jika Anda sedang mengerjakan proyek yang terkait dengan OpenCode dan menggunakan "opencode" sebagai bagian dari namanya; misalnya, "opencode-dashboard" atau "opencode-mobile", harap tambahkan catatan di README Anda untuk menjelaskan bahwa proyek tersebut tidak dibangun dan terafiliasi oleh tim OpenCode dengan cara apa pun.

---

**Bergabung dengan komunitas OpenCode** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
