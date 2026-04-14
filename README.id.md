<p align="center">https://github.com/ketut/opencode/blob/dev/README.id.md
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center">Agen pengkodean AI sumber terbuka.</p>
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
    <a href="README.id.md">Bahasa Indonesia</a>
</p>

[![OpenCode Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://opencode.ai)

---

### Instalasi

```bash
# YOLO
curl -fsSL https://opencode.ai/install | bash

# Manajer paket
npm i -g opencode-ai@latest        # or bun/pnpm/yarn
scoop install opencode             # Windows
choco install opencode             # Windows
brew install anomalyco/tap/opencode # macOS and Linux (rekomendasi, selalu termutakhirkan)
brew install opencode              # macOS and Linux (official brew formula, sedikit kurang termutakhirkan)
sudo pacman -S opencode            # Arch Linux (Stabil)
paru -S opencode-bin               # Arch Linux (Terakhir dari AUR)
mise use -g opencode               # Berbagai jenis OS
nix run nixpkgs#opencode           # or github:anomalyco/opencode untuk cabang dev terakhir
```

> [!TIP]
> Hilangkan versi lama sebelum 0.1.x sebelum menginstall.

### Aplikasi Desktop (BETA)

Opencode juga tersedia dalam aplikasi desktop. Unduh langsung dari [releases page](https://github.com/anomalyco/opencode/releases) or [opencode.ai/download](https://opencode.ai/download).

| Platform              | Unduh                                 |
| --------------------- | ------------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-darwin-aarch64.dmg` |
| macOS (Intel)         | `opencode-desktop-darwin-x64.dmg`     |
| Windows               | `opencode-desktop-windows-x64.exe`    |
| Linux                 | `.deb`, `.rpm`, atau AppImage           |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop
```

#### Direktori Instalasi

Skrip instalasi memperhatikan urutan prioritas berikut untuk jalur instalasi.:

1. `$OPENCODE_INSTALL_DIR` - Direktori instalasi khusus
2. `$XDG_BIN_DIR` - Jalur yang sesuai dengan Spesifikasi Direktori Dasar XDG
3. `$HOME/bin` - Direktori biner pengguna standar (jika ada atau dapat dibuat)
4. `$HOME/.opencode/bin` - Cadangan default

```bash
# Contoh
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### Agen

OpenCode menyertakan dua agen bawaan yang dapat Anda alihkan dengan tombol `Tab`.

- **build** - Default, Agen dengan akses penuh untuk pekerjaan pengembangan
- **plan** - Agen hanya memiliki hak baca untuk analisis dan eksplorasi kode
  - Menolak pengeditan file secara default
  - Meminta izin sebelum menjalankan perintah bash
  - Ideal untuk menjelajahi basis kode yang tidak dikenal atau merencanakan perubahan

Termasuk juga subagen **general** untuk pencarian kompleks dan tugas multi-langkah.
Ini digunakan secara internal dan dapat dipanggil menggunakan `@general` dalam pesan.

Pelajari lebih lanjut tentang [agents](https://opencode.ai/docs/agents).

### Dokumentasi

Untuk informasi lebih lanjut tentang cara mengkonfigurasi OpenCode, [**kunjungi dokumentasi kami**](https://opencode.ai/docs).

### Berkontribusi

Jika Anda tertarik untuk berkontribusi pada OpenCode, silakan baca [dokumentasi kontribusi](./CONTRIBUTING.md) kami sebelum mengirimkan pull request.

### Membangun di atas OpenCode

Jika Anda sedang mengerjakan proyek yang terkait dengan OpenCode dan menggunakan "opencode" sebagai bagian dari namanya, misalnya "opencode-dashboard" atau "opencode-mobile", harap tambahkan catatan ke README Anda untuk memperjelas bahwa proyek tersebut tidak dibuat oleh tim OpenCode dan tidak berafiliasi dengan kami dalam bentuk apa pun.

### FAQ

#### Apa perbedaannya dengan Claude Code?

OpenCode sangat mirip dengan Claude Code dalam hal kemampuan. Berikut perbedaan utamanya:

- 100% open source
- Tidak terikat pada penyedia mana pun. Meskipun kami merekomendasikan model yang kami sediakan melalui [OpenCode Zen](https://opencode.ai/zen), OpenCode dapat digunakan dengan Claude, OpenAI, Google, atau bahkan model lokal. Seiring perkembangan model, kesenjangan di antara mereka akan menyempit dan harga akan turun, sehingga tidak bergantung pada penyedia sangat penting.
- Dukungan LSP siap pakai.
- Fokus pada TUI (Table-User Interface). OpenCode dibangun oleh pengguna Neovim dan pencipta [terminal.shop](https://terminal.shop); kami akan mendorong batas kemampuan terminal.
- Arsitektur klien/server. Ini, misalnya, memungkinkan OpenCode berjalan di komputer Anda sementara Anda mengendalikannya dari jarak jauh melalui aplikasi seluler, yang berarti bahwa antarmuka TUI hanyalah salah satu klien yang mungkin.

---

**Bergabunglah dengan komunitas kami** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
