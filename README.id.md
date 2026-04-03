<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="Logo OpenCode">
    </picture>
  </a>
</p>
<p align="center">Agen coding AI sumber terbuka.</p>
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

[![Tampilan Terminal OpenCode](packages/web/src/assets/lander/screenshot.png)](https://opencode.ai)

---

### Instalasi

```bash
# YOLO
curl -fsSL https://opencode.ai/install | bash

# Package manager
npm i -g opencode-ai@latest        # atau bun/pnpm/yarn
scoop install opencode             # Windows
choco install opencode             # Windows
brew install anomalyco/tap/opencode # macOS dan Linux (direkomendasikan, selalu terbaru)
brew install opencode              # macOS dan Linux (formula brew resmi, pembaruan lebih lambat)
sudo pacman -S opencode            # Arch Linux (Stabil)
paru -S opencode-bin               # Arch Linux (Terbaru dari AUR)
mise use -g opencode               # Semua OS
nix run nixpkgs#opencode           # atau github:anomalyco/opencode untuk branch dev terbaru
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

Skrip instalasi mengikuti urutan prioritas berikut untuk menentukan lokasi instalasi:

1. `$OPENCODE_INSTALL_DIR` - Direktori instalasi kustom
2. `$XDG_BIN_DIR` - Path sesuai spesifikasi XDG Base Directory
3. `$HOME/bin` - Direktori binary pengguna standar (jika ada atau dapat dibuat)
4. `$HOME/.opencode/bin` - Fallback default

```bash
# Contoh
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### Agen

OpenCode memiliki dua agen bawaan yang dapat Anda ganti dengan tombol `Tab`.

- **build** - Agen default dengan akses penuh untuk pekerjaan pengembangan
- **plan** - Agen hanya-baca untuk analisis dan eksplorasi kode
  - Menolak pengeditan file secara default
  - Meminta izin sebelum menjalankan perintah bash
  - Ideal untuk menjelajahi codebase yang belum dikenal atau merencanakan perubahan

Tersedia juga subagen **general** untuk pencarian kompleks dan tugas bertahap.
Digunakan secara internal dan dapat dipanggil menggunakan `@general` dalam pesan.

Pelajari lebih lanjut tentang [agen](https://opencode.ai/docs/agents).

### Dokumentasi

Untuk informasi lebih lanjut tentang cara mengonfigurasi OpenCode, [**kunjungi dokumentasi kami**](https://opencode.ai/docs).

### Berkontribusi

Jika Anda tertarik untuk berkontribusi pada OpenCode, silakan baca [panduan kontribusi](./CONTRIBUTING.md) sebelum mengajukan pull request.

### Membangun di Atas OpenCode

Jika Anda mengerjakan proyek yang berkaitan dengan OpenCode dan menggunakan "opencode" sebagai bagian dari namanya, misalnya "opencode-dashboard" atau "opencode-mobile", harap tambahkan catatan di README Anda untuk menjelaskan bahwa proyek tersebut tidak dibuat oleh tim OpenCode dan tidak berafiliasi dengan kami dengan cara apa pun.

### FAQ

#### Apa bedanya dengan Claude Code?

Kemampuannya sangat mirip dengan Claude Code. Berikut perbedaan utamanya:

- 100% sumber terbuka
- Tidak terikat pada satu provider. Meskipun kami merekomendasikan model yang kami sediakan melalui [OpenCode Zen](https://opencode.ai/zen), OpenCode dapat digunakan dengan Claude, OpenAI, Google, atau bahkan model lokal. Seiring berkembangnya model, kesenjangan di antara mereka akan mengecil dan harga akan turun, sehingga menjadi provider-agnostic itu penting.
- Dukungan LSP bawaan
- Fokus pada TUI. OpenCode dibangun oleh pengguna neovim dan pencipta [terminal.shop](https://terminal.shop); kami akan mendorong batas kemungkinan di terminal.
- Arsitektur client/server. Ini, misalnya, memungkinkan OpenCode berjalan di komputer Anda sementara Anda mengendalikannya dari jarak jauh melalui aplikasi mobile, artinya frontend TUI hanyalah salah satu dari klien yang mungkin ada.

---

**Bergabunglah dengan komunitas kami** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
