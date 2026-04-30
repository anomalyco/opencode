<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center">AI coding agent open source.</p>
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

### Instalasi

```bash
# YOLO
curl -fsSL https://opencode.ai/install | bash

# Package managers
npm i -g opencode-ai@latest        # atau bun/pnpm/yarn
scoop install opencode             # Windows
choco install opencode             # Windows
brew install anomalyco/tap/opencode # macOS dan Linux (disarankan, selalu terbaru)
brew install opencode              # macOS dan Linux (formula brew resmi, pembaruan lebih lambat)
sudo pacman -S opencode            # Arch Linux (Stabil)
paru -S opencode-bin               # Arch Linux (Versi terbaru dari AUR)
mise use -g opencode               # OS apa pun
nix run nixpkgs#opencode           # atau github:anomalyco/opencode untuk branch dev terbaru
```

> [!TIP]
> Hapus versi yang lebih lama dari 0.1.x sebelum melakukan instalasi.

### Desktop App (BETA)

OpenCode juga tersedia sebagai aplikasi desktop. Unduh langsung dari [halaman releases](https://github.com/anomalyco/opencode/releases) atau [opencode.ai/download](https://opencode.ai/download).

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

Script instalasi mengikuti urutan prioritas berikut untuk menentukan jalur instalasi:

1. `$OPENCODE_INSTALL_DIR` - Direktori instalasi kustom
2. `$XDG_BIN_DIR` - Jalur sesuai spesifikasi XDG Base Directory
3. `$HOME/bin` - Direktori binary pengguna standar (jika sudah ada atau dapat dibuat)
4. `$HOME/.opencode/bin` - Fallback default

```bash
# Contoh
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### Agent

OpenCode menyertakan dua agent bawaan yang bisa kamu ganti dengan menekan tombol `Tab`.

- **build** - Agent default dengan akses penuh untuk pekerjaan pengembangan
- **plan** - Agent read-only untuk analisis dan eksplorasi kode
  - Menolak pengeditan file secara default
  - Meminta izin sebelum menjalankan perintah bash
  - Ideal untuk menjelajahi codebase yang belum dikenal atau merencanakan perubahan

Tersedia juga subagent **general** untuk pencarian kompleks dan tugas multi-langkah.
Subagent ini digunakan secara internal dan dapat dipanggil menggunakan `@general` dalam pesan.

Pelajari lebih lanjut tentang [agent](https://opencode.ai/docs/agents).

### Dokumentasi

Untuk informasi lebih lanjut tentang cara mengonfigurasi OpenCode, [**kunjungi dokumentasi kami**](https://opencode.ai/docs).

### Berkontribusi

Jika kamu tertarik untuk berkontribusi pada OpenCode, silakan baca [panduan kontribusi](./CONTRIBUTING.md) sebelum mengajukan pull request.

### Membangun di Atas OpenCode

Jika kamu sedang mengerjakan proyek yang berkaitan dengan OpenCode dan menggunakan kata "opencode" sebagai bagian dari namanya, misalnya "opencode-dashboard" atau "opencode-mobile", harap tambahkan catatan di README-mu untuk memperjelas bahwa proyek tersebut tidak dibuat oleh tim OpenCode dan tidak berafiliasi dengan kami dengan cara apa pun.

### FAQ

#### Apa bedanya dengan Claude Code?

Kemampuannya sangat mirip dengan Claude Code. Berikut adalah perbedaan utamanya:

- 100% open source
- Tidak terikat pada provider tertentu. Meskipun kami merekomendasikan model yang kami sediakan melalui [OpenCode Zen](https://opencode.ai/zen), OpenCode dapat digunakan dengan Claude, OpenAI, Google, atau bahkan model lokal. Seiring berkembangnya model, kesenjangan di antara mereka akan semakin kecil dan harga akan turun, sehingga menjadi provider-agnostic adalah hal yang penting.
- Dukungan LSP siap pakai
- Fokus pada TUI. OpenCode dibangun oleh pengguna neovim dan para kreator [terminal.shop](https://terminal.shop); kami akan terus mendorong batas-batas yang mungkin dilakukan di dalam terminal.
- Arsitektur client/server. Hal ini memungkinkan OpenCode berjalan di komputermu sementara kamu mengendalikannya dari jarak jauh melalui aplikasi mobile, yang berarti frontend TUI hanyalah salah satu dari sekian banyak client yang memungkinkan.

---

**Bergabunglah dengan komunitas kami** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
