<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center">AI Coding Agent yang bersumber terbuka.</p>
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
  <a href="README.ar.md">العربية</a> |
  <a href="README.no.md">Norsk</a> |
  <a href="README.br.md">Português (Brasil)</a> |
  <a href="README.th.md">ไทย</a> |
  <a href="README.tr.md">Türkçe</a> |
  <a href="README.uk.md">Українська</a> |
  <a href="README.bn.md">বাংলা</a>
</p>

[![OpenCode Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://opencode.ai)

---

### Instalasi

```bash
# YOLO (langsung instal)
curl -fsSL https://opencode.ai/install | bash

# Package manager
npm i -g opencode-ai@latest        # atau bun/pnpm/yarn
scoop install opencode             # Windows
choco install opencode             # Windows
brew install anomalyco/tap/opencode # macOS dan Linux (direkomendasikan, selalu terbaru)
brew install opencode              # macOS dan Linux (rumus brew resmi, update lebih jarang)
sudo pacman -S opencode            # Arch Linux (Stable)
paru -S opencode-bin               # Arch Linux (Latest dari AUR)
mise use -g opencode               # Sistem apapun
nix run nixpkgs#opencode           # atau github:anomalyco/opencode untuk branch dev terbaru
```

> [!TIP]
> Hapus versi lama sebelum 0.1.x sebelum menginstal.

### Aplikasi Desktop (BETA)

OpenCode juga tersedia sebagai aplikasi desktop. Unduh langsung dari [halaman rilis (releases page)](https://github.com/anomalyco/opencode/releases) atau [opencode.ai/download](https://opencode.ai/download).

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

Skrip instalasi menghormati urutan prioritas berikut untuk path instalasi:

1. `$OPENCODE_INSTALL_DIR` - Direktori instalasi kustom
2. `$XDG_BIN_DIR` - Path yang sesuai spesifikasi XDG Base Directory
3. `$HOME/bin` - Direktori biner standar user (jika ada atau dapat dibuat)
4. `$HOME/.opencode/bin` - Fallback default

```bash
# Contoh
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### Agent

OpenCode memiliki dua agent bawaan yang dapat di-switch menggunakan tombol `Tab`:

- **build** - Default, agent dengan akses penuh untuk pekerjaan pengembangan
- **plan** - Agent baca-saja untuk analisis dan eksplorasi kode
  - Default menolak edit file
  - Menanyakan izin sebelum menjalankan perintah bash
  - Ideal untuk mengeksplorasi codebase yang tidak dikenal atau merencanakan perubahan

Juga termasuk **general** sub-agent untuk pencarian kompleks dan tugas multi-langkah. Digunakan secara internal dan dapat dipanggil menggunakan `@general` di pesan.

Pelajari lebih lanjut tentang [agents](https://opencode.ai/docs/agents).

### Dokumentasi

Untuk informasi lebih lanjut tentang cara mengkonfigurasi OpenCode, [**silakan kunjungi dokumentasi kami**](https://opencode.ai/docs).

### Kontribusi

Jika berminat berkontribusi ke OpenCode, baca dokumentasi kontribusi [sebelum mengirim PR](./CONTRIBUTING.md).

### Pengembangan Berbasis OpenCode

Jika Anda sedang bekerja pada proyek yang terkait dengan OpenCode dan menggunakan "opencode" sebagai bagian dari namanya, misalnya "opencode-dashboard" atau "opencode-mobile", harap tambahkan catatan di README Anda bahwa proyek tersebut tidak dibuat oleh tim OpenCode dan tidak berafiliasi dengan kami dalam cara apa pun.

### FAQ

#### Apa bedanya dengan Claude Code?

Secara kemampuan sangat mirip dengan Claude Code. Perbedaan utamanya:

- 100% bersumber terbuka (open source)
- Tidak terikat ke penyedia tertentu. Meskipun kami merekomendasikan model yang kami sediakan melalui [OpenCode Zen](https://opencode.ai/zen), OpenCode dapat digunakan dengan Claude, OpenAI, Google, atau bahkan model lokal. Karena model terus berkembang dan selisih akan berkurang serta harga akan turun, menjadi provider-agnostik sangat penting.
- Dukungan LSP siap pakai
- Fokus pada TUI. OpenCode dibuat oleh pengguna Neovim dan pencipta [terminal.shop](https://terminal.shop); kami akan terus mengusahakan batas-batas yang mungkin di terminal.
- Arsitektur klien/server. Ini, misalnya, memungkinkan OpenCode berjalan di komputer Anda sambil Anda mengdriven secara jarak jauh dari aplikasi mobile, artinya TUI frontend hanyalah salah satu dari banyak klien yang mungkin.

---

**Gabung komunitas kami** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
