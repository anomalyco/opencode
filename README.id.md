<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="Logo OpenCode">
    </picture>
  </a>
</p>
<p align="center">Agen coding AI open source.</p>
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

[![Terminal UI OpenCode](packages/web/src/assets/lander/screenshot.png)](https://opencode.ai)

---

### Instalasi

```bash
# YOLO
curl -fsSL https://opencode.ai/install | bash

# Package managers
npm i -g opencode-ai@latest        # atau bun/pnpm/yarn
scoop install opencode             # Windows
choco install opencode             # Windows
brew install anomalyco/tap/opencode # macOS dan Linux (direkomendasikan, selalu terbaru)
brew install opencode              # macOS dan Linux (formula brew resmi, jarang diperbarui)
sudo pacman -S opencode            # Arch Linux (Stabil)
paru -S opencode-bin               # Arch Linux (Terbaru dari AUR)
mise use -g opencode               # Semua OS
nix run nixpkgs#opencode           # atau github:anomalyco/opencode untuk branch dev terbaru
```

> [!TIP]
> Hapus versi yang lebih lama dari 0.1.x sebelum melakukan proses instalasi.

### Aplikasi Desktop (BETA)

OpenCode juga tersedia dalam bentuk aplikasi desktop. Unduh langsung melalui [halaman rilis](https://github.com/anomalyco/opencode/releases) atau [opencode.ai/download](https://opencode.ai/download).

| Platform              | Unduh                              |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `opencode-desktop-mac-x64.dmg`     |
| Windows               | `opencode-desktop-windows-x64.exe` |
| Linux                 | `.deb`, `.rpm`, atau `.AppImage`   |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop
```

#### Direktori Instalasi

Skrip instalasi mengikuti urutan prioritas berikut untuk jalur instalasi:

1. `$OPENCODE_INSTALL_DIR` - Direktori instalasi kustom
2. `$XDG_BIN_DIR` - Jalur yang sesuai dengan XDG Base Directory Specification
3. `$HOME/bin` - Direktori biner pengguna standar (jika ada atau dapat dibuat)
4. `$HOME/.opencode/bin` - Fallback bawaan

```bash
# Contoh
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### Agen

OpenCode disertakan dengan dua agen bawaan yang dapat Anda ubah dengan tombol `Tab`.

- **build** - Agen akses penuh default untuk pekerjaan pengembangan
- **plan** - Agen read-only untuk analisis dan eksplorasi kode
  - Menolak pengeditan file secara bawaan
  - Meminta izin sebelum menjalankan perintah bash
  - Ideal untuk menjelajahi basis kode yang tidak dikenal atau merencanakan perubahan

Juga tersedia subagen **general** untuk pencarian kompleks dan tugas multi-langkah.
Ini digunakan secara internal dan dapat dipanggil menggunakan `@general` di pesan.

Pelajari lebih lanjut tentang [agen](https://opencode.ai/docs/agents).

### Dokumentasi

Untuk informasi lebih lanjut tentang cara melakukan konfigurasi OpenCode, [**kunjungi dokumentasi kami**](https://opencode.ai/docs).

### Berkontribusi

Jika Anda tertarik untuk berkontribusi ke OpenCode, silakan baca [dokumen kontribusi](./CONTRIBUTING.md) kami sebelum mengirimkan pull request.

### Membangun di Atas OpenCode

Jika Anda mengerjakan proyek yang terkait dengan OpenCode dan menggunakan "opencode" sebagai bagian dari namanya, misalnya "opencode-dashboard" atau "opencode-mobile", harap tambahkan catatan di README Anda untuk menjelaskan bahwa proyek tersebut tidak dibuat oleh tim OpenCode dan tidak berafiliasi dengan kami dengan cara apa pun.

---

**Bergabunglah dengan komunitas kami** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
