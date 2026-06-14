<p align="center">
  <a href="https://daemonprotocol.com">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="Daemon Protocol logo">
    </picture>
  </a>
</p>
<p align="center">Açık kaynaklı yapay zeka kodlama asistanı.</p>
<p align="center">
  <a href="https://daemonprotocol.com/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/daemoncode"><img alt="npm" src="https://img.shields.io/npm/v/daemoncode?style=flat-square" /></a>
  <a href="https://github.com/daemon-blockint-tech/daemoncode/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/daemon-blockint-tech/daemoncode/publish.yml?style=flat-square&branch=dev" /></a>
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

[![Daemon Protocol Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://daemonprotocol.com)

---

### Kurulum

```bash
# YOLO
curl -fsSL https://daemonprotocol.com/install | bash

# Paket yöneticileri
npm i -g daemoncode@latest        # veya bun/pnpm/yarn
scoop install daemoncode             # Windows
choco install daemoncode             # Windows
brew install daemon-blockint-tech/tap/daemoncode # macOS ve Linux (önerilir, her zaman güncel)
brew install daemoncode              # macOS ve Linux (resmi brew formülü, daha az güncellenir)
sudo pacman -S daemoncode            # Arch Linux (Stable)
paru -S daemoncode-bin               # Arch Linux (Latest from AUR)
mise use -g daemoncode               # Tüm işletim sistemleri
nix run nixpkgs#daemoncode           # veya en güncel geliştirme dalı için github:daemon-blockint-tech/daemoncode
```

> [!TIP]
> Kurulumdan önce 0.1.x'ten eski sürümleri kaldırın.

### Masaüstü Uygulaması (BETA)

Daemon Protocol ayrıca masaüstü uygulaması olarak da mevcuttur. Doğrudan [sürüm sayfasından](https://github.com/daemon-blockint-tech/daemoncode/releases) veya [daemonprotocol.com/download](https://daemonprotocol.com/download) adresinden indirebilirsiniz.

| Platform              | İndirme                            |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `daemoncode-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `daemoncode-desktop-mac-x64.dmg`     |
| Windows               | `daemoncode-desktop-windows-x64.exe` |
| Linux                 | `.deb`, `.rpm` veya AppImage       |

```bash
# macOS (Homebrew)
brew install --cask daemoncode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/daemoncode-desktop
```

#### Kurulum Dizini (Installation Directory)

Kurulum betiği (install script), kurulum yolu (installation path) için aşağıdaki öncelik sırasını takip eder:

1. `$OPENCODE_INSTALL_DIR` - Özel kurulum dizini
2. `$XDG_BIN_DIR` - XDG Base Directory Specification uyumlu yol
3. `$HOME/bin` - Standart kullanıcı binary dizini (varsa veya oluşturulabiliyorsa)
4. `$HOME/.opencode/bin` - Varsayılan yedek konum

```bash
# Örnekler
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://daemonprotocol.com/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://daemonprotocol.com/install | bash
```

### Ajanlar

Daemon Protocol, `Tab` tuşuyla aralarında geçiş yapabileceğiniz iki yerleşik (built-in) ajan içerir.

- **build** - Varsayılan, geliştirme çalışmaları için tam erişimli ajan
- **plan** - Analiz ve kod keşfi için salt okunur ajan
  - Varsayılan olarak dosya düzenlemelerini reddeder
  - Bash komutlarını çalıştırmadan önce izin ister
  - Tanımadığınız kod tabanlarını keşfetmek veya değişiklikleri planlamak için ideal

Ayrıca, karmaşık aramalar ve çok adımlı görevler için bir **genel** alt ajan bulunmaktadır.
Bu dahili olarak kullanılır ve mesajlarda `@general` ile çağrılabilir.

[Ajanlar](https://daemonprotocol.com/docs/agents) hakkında daha fazla bilgi edinin.

### Dokümantasyon

Daemon Protocol'u nasıl yapılandıracağınız hakkında daha fazla bilgi için [**dokümantasyonumuza göz atın**](https://daemonprotocol.com/docs).

### Katkıda Bulunma

Daemon Protocol'a katkıda bulunmak istiyorsanız, lütfen bir pull request göndermeden önce [katkıda bulunma dokümanlarımızı](./CONTRIBUTING.md) okuyun.

### Daemon Protocol Üzerine Geliştirme

Daemon Protocol ile ilgili bir proje üzerinde çalışıyorsanız ve projenizin adının bir parçası olarak "opencode" kullanıyorsanız (örneğin, "opencode-dashboard" veya "opencode-mobile"), lütfen README dosyanıza projenin Daemon Protocol ekibi tarafından geliştirilmediğini ve bizimle hiçbir şekilde bağlantılı olmadığını belirten bir not ekleyin.

---

**Topluluğumuza katılın** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
