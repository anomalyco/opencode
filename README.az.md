<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode loqosu">
    </picture>
  </a>
</p>
<p align="center">Açıq mənbəli süni intellekt kodlama agenti.</p>
<p align="center">
  <a href="https://opencode.ai/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/opencode-ai"><img alt="npm" src="https://img.shields.io/npm/v/opencode-ai?style=flat-square" /></a>
  <a href="https://github.com/anomalyco/opencode/actions/workflows/publish.yml"><img alt="Qurma statusu" src="https://img.shields.io/github/actions/workflow/status/anomalyco/opencode/publish.yml?style=flat-square&branch=dev" /></a>
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
  <a href="README.az.md">Azərbaycan</a>
</p>

[![OpenCode Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://opencode.ai)

---

### Quraşdırma

```bash
# YOLO
curl -fsSL https://opencode.ai/install | bash

# Paket menecerləri
npm i -g opencode-ai@latest        # və ya bun/pnpm/yarn
scoop install opencode             # Windows
choco install opencode             # Windows
brew install anomalyco/tap/opencode # macOS və Linux (tövsiyə olunur, həmişə yenidir)
brew install opencode              # macOS və Linux (rəsmi brew formulu, daha az yenilənir)
sudo pacman -S opencode            # Arch Linux (Stabil)
paru -S opencode-bin               # Arch Linux (AUR-dan ən son versiya)
mise use -g opencode               # İstənilən OS
nix run nixpkgs#opencode           # və ya ən son dev branch üçün github:anomalyco/opencode
```

> [!TIP]
> Quraşdırmadan əvvəl 0.1.x-dən köhnə versiyaları silin.

### Masaüstü Tətbiq (BETA)

OpenCode həmçinin masaüstü tətbiq kimi də mövcuddur. Birbaşa [buraxılışlar səhifəsindən](https://github.com/anomalyco/opencode/releases) və ya [opencode.ai/download](https://opencode.ai/download) ünvanından yükləyin.

| Platforma             | Yükləmə                               |
| --------------------- | ------------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-darwin-aarch64.dmg` |
| macOS (Intel)         | `opencode-desktop-darwin-x64.dmg`     |
| Windows               | `opencode-desktop-windows-x64.exe`    |
| Linux                 | `.deb`, `.rpm` və ya AppImage         |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop
```

#### Quraşdırma Qovluğu

Quraşdırma skripti quraşdırma yolu üçün aşağıdakı prioritet sırasına əməl edir:

1. `$OPENCODE_INSTALL_DIR` - Xüsusi quraşdırma qovluğu
2. `$XDG_BIN_DIR` - XDG Baza Qovluq Spesifikasiyasına uyğun yol
3. `$HOME/bin` - Standart istifadəçi ikili qovluğu (mövcuddursa və ya yaradıla bilirsə)
4. `$HOME/.opencode/bin` - Standart ehtiyat

```bash
# Nümunələr
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### Agentlər

OpenCode `Tab` düyməsi ilə arasında keçid edə biləcəyiniz iki daxili agent ehtiva edir.

- **build** - İnkişaf işləri üçün tam giriş imkanına malik standart agent
- **plan** - Analiz və kod araşdırması üçün yalnız oxuma agenti
  - Varsayılan olaraq fayl redaktəsini rədd edir
  - Bash əmrlərini icra etməzdən əvvəl icazə istəyir
  - Tanış olmayan kod bazalarını araşdırmaq və ya dəyişiklikləri planlaşdırmaq üçün idealdır

Mürəkkəb axtarışlar və çoxpilləli tapşırıqlar üçün **general** subagenti də daxildir.
Bu daxili istifadə olunur və mesajlarda `@general` yazaraq çağırıla bilər.

[Agentlər](https://opencode.ai/docs/agents) haqqında daha çox öyrənin.

### Sənədlər

OpenCode-u necə konfiqurasiya etmək barədə daha çox məlumat üçün [**sənədlərimizə baxın**](https://opencode.ai/docs).

### Töhfə vermək

OpenCode-a töhfə vermək istəyirsinizsə, pull request göndərməzdən əvvəl [töhfə sənədlərimizi](./CONTRIBUTING.md) oxuyun.

### OpenCode üzərində qurmaq

Əgər OpenCode ilə əlaqəli bir layihə üzərində işləyirsinizsə və adının bir hissəsi kimi "opencode" istifadə edirsinizsə, məsələn, "opencode-dashboard" və ya "opencode-mobile", README faylınıza bu layihənin OpenCode komandası tərəfindən qurulmadığını və heç bir şəkildə bizimlə əlaqəli olmadığını açıqlayan bir qeyd əlavə edin.

### TVS

#### Bu Claude Code-dan nə ilə fərqlənir?

İmkanlar baxımından Claude Code-a çox oxşardır. Əsas fərqlər bunlardır:

- 100% açıq mənbəli
- Heç bir provayderlə bağlı deyil. [OpenCode Zen](https://opencode.ai/zen) vasitəsilə təqdim etdiyimiz modelləri tövsiyə etsək də, OpenCode Claude, OpenAI, Google və ya hətta lokal modellərlə istifadə edilə bilər. Modellər inkişaf etdikcə aralarındakı fərqlər azalacaq və qiymətlər düşəcək, buna görə provayder-neytrallığı vacibdir.
- Qutusundan çıxan kimi LSP dəstəyi
- TUI-ya diqqət. OpenCode neovim istifadəçiləri və [terminal.shop](https://terminal.shop)-un yaradıcıları tərəfindən qurulub; biz terminalda mümkün olanın hüdudlarını genişləndirəcəyik.
- Müştəri/server arxitekturası. Bu, məsələn, OpenCode-un kompüterinizdə işləməsinə imkan verə bilər, siz isə onu bir mobil tətbiqdən uzaqdan idarə edərsiniz, yəni TUI ön ucu mümkün müştərilərdən yalnız biridir.

---

**İcmamıza qoşulun** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
