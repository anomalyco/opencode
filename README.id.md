<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="Logo OpenCode">
    </picture>
  </a>
</p>
<p align="center">Agen AI coding sumber terbuka.</p>
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
  <a href="README.id.md">Bahasa Indonesia</a>
</p>

[![Antarmuka Terminal OpenCode](packages/web/src/assets/lander/screenshot.png)](https://opencode.ai)

---

### Instalasi

```bash
# YOLO
curl -fsSL https://opencode.ai/install | bash

# Manajer paket
npm i -g opencode-ai@latest        # atau bun/pnpm/yarn
scoop install opencode             # Windows
choco install opencode             # Windows
brew install anomalyco/tap/opencode # macOS dan Linux (direkomendasikan, selalu terbaru)
brew install opencode              # macOS dan Linux (formula brew resmi, pembaruan lebih jarang)
sudo pacman -S opencode            # Arch Linux (Stabil)
paru -S opencode-bin               # Arch Linux (Terbaru dari AUR)
mise use -g opencode               # Semua OS
nix run nixpkgs#opencode           # atau github:anomalyco/opencode untuk cabang dev terbaru
```

> [!TIP]
> Hapus versi yang lebih lama dari 0.1.x sebelum menginstal.

### Aplikasi Desktop (BETA)

OpenCode juga tersedia sebagai aplikasi desktop. Unduh langsung dari [halaman rilis](https://github.com/anomalyco/opencode/releases) atau [opencode.ai/download](https://opencode.ai/download).

| Platform              | Unduhan                               |
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

#### Direktori Instalasi

Skrip instalasi mengikuti urutan prioritas berikut untuk menentukan jalur instalasi:

1. `$OPENCODE_INSTALL_DIR` - Direktori instalasi kustom
2. `$XDG_BIN_DIR` - Jalur sesuai Spesifikasi Direktori Dasar XDG
3. `$HOME/bin` - Direktori biner pengguna standar (jika sudah ada atau bisa dibuat)
4. `$HOME/.opencode/bin` - Cadangan default

```bash
# Contoh
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### Agen

OpenCode dilengkapi dua agen bawaan yang bisa kamu ganti menggunakan tombol `Tab`.

- **build** - Agen default dengan akses penuh untuk pekerjaan pengembangan
- **plan** - Agen hanya baca untuk analisis dan eksplorasi kode
  - Secara default menolak pengeditan file
  - Meminta izin sebelum menjalankan perintah bash
  - Ideal untuk menjelajahi basis kode yang belum dikenal atau merencanakan perubahan

Tersedia juga subagen **general** untuk pencarian kompleks dan tugas multi-langkah.
Subagen ini digunakan secara internal dan bisa dipanggil dengan `@general` dalam pesan.

Pelajari lebih lanjut tentang [agen](https://opencode.ai/docs/agents).

### Dokumentasi

Untuk informasi lebih lanjut tentang cara mengonfigurasi OpenCode, [**kunjungi dokumentasi kami**](https://opencode.ai/docs).

### Berkontribusi

Jika kamu tertarik berkontribusi pada OpenCode, silakan baca [panduan kontribusi](./CONTRIBUTING.md) sebelum mengajukan pull request.

### Mengembangkan Proyek Berbasis OpenCode

Jika kamu sedang mengerjakan proyek yang berkaitan dengan OpenCode dan menggunakan "opencode" sebagai bagian dari namanya, misalnya "opencode-dashboard" atau "opencode-mobile", harap tambahkan catatan di README kamu untuk menjelaskan bahwa proyek tersebut bukan buatan tim OpenCode dan tidak berafiliasi dengan kami dalam bentuk apapun.

### FAQ

#### Apa bedanya dengan Claude Code?

Kemampuannya sangat mirip dengan Claude Code. Berikut perbedaan utamanya:

- 100% sumber terbuka
- Tidak terikat pada penyedia tertentu. Meski kami merekomendasikan model yang kami sediakan melalui [OpenCode Zen](https://opencode.ai/zen), OpenCode bisa digunakan dengan Claude, OpenAI, Google, atau bahkan model lokal. Seiring berkembangnya model, kesenjangan di antara mereka akan mengecil dan harganya akan turun, sehingga bersikap netral terhadap penyedia itu penting.
- Dukungan LSP siap pakai tanpa konfigurasi tambahan
- Fokus pada TUI. OpenCode dibuat oleh pengguna neovim dan para pembuat [terminal.shop](https://terminal.shop); kami akan terus mendorong batas kemungkinan di dalam terminal.
- Arsitektur klien/server. Hal ini, misalnya, memungkinkan OpenCode berjalan di komputermu sementara kamu mengendalikannya dari jarak jauh melalui aplikasi mobile, artinya frontend TUI hanyalah salah satu dari kemungkinan klien yang ada.

---

**Bergabunglah dengan komunitas kami** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
