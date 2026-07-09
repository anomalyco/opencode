<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="logo OpenCode">
    </picture>
  </a>
</p>
<p align="center">Agen Pengkodean AI Sumber Terbuka</p>
<p align="center">
  <a href="https://opencode.ai/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/opencode-ai"><img alt="npm" src="https://img.shields.io/npm/v/opencode-ai?style=flat-square" /></a>
  <a href="https://github.com/anomalyco/opencode/actions/workflows/publish.yml"><img alt="Status pembangunan" src="https://img.shields.io/github/actions/workflow/status/anomalyco/opencode/publish.yml?style=flat-square&branch=dev" /></a>
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
  <a href="README.id.md">Indonesia</a>
</p>

[![Antarmuka Pengguna Terminal OpenCode](packages/web/src/assets/lander/screenshot.png)](https://opencode.ai)

---

### Instalasi

```bash
# YOLO
curl -fsSL https://opencode.ai/install | bash

# Pengelola paket
npm i -g opencode-ai@latest        # atau bun/pnpm/yarn
scoop install opencode             # Windows
choco install opencode             # Windows
brew install anomalyco/tap/opencode # macOS dan Linux (Direkomendasikan, selalu terkini)
brew install opencode              # macOS and Linux (formula pembuatan resmi, diperbarui lebih jarang)
sudo pacman -S opencode            # Arch Linux (Stabil)
paru -S opencode-bin               # Arch Linux (Terbaru dari AUR)
mise use -g opencode               # Sistem Operasi Apa Pun
nix run nixpkgs#opencode           # atau github:anomalyco/opencode untuk cabang dev terbaru
```

> [!TIP] 
> Hapus versi yang lebih lama dari 0.1.x sebelum menginstal.

### Aplikasi Desktop (BETA)

OpenCode juga tersedia sebagai aplikasi desktop. Unduh langsung dari [halaman rilis](https://github.com/anomalyco/opencode/releases) atau [opencode.ai/download](https://opencode.ai/download).

| Platform              | Unduh                           |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `opencode-desktop-mac-x64.dmg`     |
| Windows               | `opencode-desktop-windows-x64.exe` |
| Linux                 | `.deb`, `.rpm`, atau `.AppImage`     |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop
```

#### Direktori Instalasi

Skrip instalasi memperhatikan urutan prioritas berikut untuk jalur instalasi:

1. `$OPENCODE_INSTALL_DIR` - Direktori instalasi khusus
2. `$XDG_BIN_DIR` - Jalur yang sesuai dengan Spesifikasi Direktori Dasar XDG
3. `$HOME/bin` - Direktori biner pengguna standar (jika ada atau dapat dibuat)
4. `$HOME/.opencode/bin` - Opsi cadangan default

```bash
# Contoh
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### Agen

OpenCode menyertakan dua agen bawaan yang dapat Anda alihkan dengan tombol `Tab`.

- **build** - Agen default dengan akses penuh untuk pekerjaan pengembangan
- **plan** - Agen baca-saja untuk analisis dan eksplorasi kode
  - Secara default, pengeditan file ditolak
  - Meminta izin sebelum menjalankan perintah bash
  - Ideal untuk menjelajahi basis kode yang tidak dikenal atau merencanakan perubahan

Termasuk juga subagen **umum** untuk pencarian kompleks dan tugas multi-langkah.
Ini digunakan secara internal dan dapat dipanggil menggunakan `@general` dalam pesan.

Pelajari lebih lanjut tentang [agen](https://opencode.ai/docs/agents).

### Dokumentasi

Untuk informasi lebih lanjut tentang cara mengkonfigurasi OpenCode, [**kunjungi dokumentasi kami**](https://opencode.ai/docs).

### Berkontribusi

Jika Anda tertarik untuk berkontribusi pada OpenCode, silakan baca [dokumentasi kontribusi](./CONTRIBUTING.md) kami sebelum mengirimkan permintaan pull.

### Membangun di atas OpenCode

Jika Anda sedang mengerjakan proyek yang terkait dengan OpenCode dan menggunakan kata "opencode" sebagai bagian dari namanya, misalnya "opencode-dashboard" atau "opencode-mobile", harap tambahkan catatan pada README Anda untuk memperjelas bahwa proyek tersebut tidak dibuat oleh tim OpenCode dan tidak berafiliasi dengan kami dalam hal apa pun.

---

**Bergabunglah dengan komunitas kami** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
