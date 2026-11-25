<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset=".github/assets/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset=".github/assets/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src=".github/assets/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center">Agen koding AI sumber terbuka.</p>
<p align="center">
  <a href="https://opencode.ai/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/@opencode/cli"><img alt="npm" src="https://img.shields.io/npm/v/@opencode/cli?style=flat-square" /></a>
  <a href="https://github.com/anomalyco/opencode/actions/workflows/release.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/anomalyco/opencode/release.yml?style=flat-square&branch=dev" /></a>
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

[![OpenCode Terminal UI](services/site/public/v1/docs/assets/lander/screenshot.png)](https://opencode.ai)

---

### Instalasi

```bash
# YOLO
curl -fsSL https://opencode.ai/v2/install | bash

# Manajer paket
npm i -g @opencode/cli@latest      # atau bun/pnpm/yarn
brew install anomalyco/tap/opencode-v2 # macOS dan Linux (direkomendasikan, selalu terbaru)
brew install opencode              # macOS dan Linux (formula brew resmi, lebih jarang diperbarui)
sudo pacman -S opencode            # Arch Linux (Stabil)
paru -S opencode-beta              # Arch Linux (Terbaru dari AUR)
mise use -g opencode               # Semua OS
nix run github:anomalyco/opencode  # Nix
```

> [!TIP]
> Hapus versi yang lebih lama dari 0.1.x sebelum menginstal.

### Aplikasi Desktop (BETA)

OpenCode juga tersedia sebagai aplikasi desktop. Unduh dari [opencode.ai/download](https://opencode.ai/download).

| Platform              | Unduhan                            |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `opencode-desktop-mac-x64.dmg`     |
| Windows               | `opencode-desktop-win-x64.exe`     |
| Linux                 | `.deb`, `.rpm`, atau `.AppImage`   |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
```

#### Direktori Instalasi

Skrip instalasi memasang OpenCode ke `$HOME/.opencode/bin`.

### Agen

OpenCode menyertakan dua agen bawaan yang dapat Anda ganti menggunakan tombol `Tab`.

- **build** - Agen bawaan dengan akses penuh untuk pekerjaan pengembangan
- **plan** - Agen hanya-baca untuk analisis dan eksplorasi kode
  - Menolak pengeditan file secara bawaan
  - Meminta izin sebelum menjalankan perintah bash
  - Ideal untuk menjelajahi basis kode yang belum dikenal atau merencanakan perubahan

Tersedia juga sub-agen **general** untuk pencarian kompleks dan tugas bertahap.
Sub-agen ini digunakan secara internal dan dapat dipanggil menggunakan `@general` di dalam pesan.

Pelajari lebih lanjut tentang [agen](https://opencode.ai/docs/agents).

### Dokumentasi

Untuk informasi lebih lanjut tentang cara mengonfigurasi OpenCode, [**kunjungi dokumentasi kami**](https://opencode.ai/docs).

### Berkontribusi

Jika Anda tertarik untuk berkontribusi pada OpenCode, silakan baca [panduan kontribusi](./CONTRIBUTING.md) kami sebelum mengajukan pull request.

### Membangun Proyek dengan OpenCode

Jika Anda sedang mengerjakan proyek yang berkaitan dengan OpenCode dan menggunakan kata "opencode" sebagai bagian dari namanya, misalnya "opencode-dashboard" atau "opencode-mobile", harap tambahkan catatan di README Anda untuk menjelaskan bahwa proyek tersebut tidak dibuat oleh tim OpenCode dan tidak berafiliasi dengan kami dalam bentuk apa pun.

---

**Bergabunglah dengan komunitas kami** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
