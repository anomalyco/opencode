<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center">Açıq mənbəli AI kodlaşdırma agenti.</p>
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
  <a href="README.az.md">Azərbaycanca</a> |
  <a href="README.uk.md">Українська</a> |
  <a href="README.bn.md">বাংলা</a> |
  <a href="README.gr.md">Ελληνικά</a>
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
brew install anomalyco/tap/opencode # macOS və Linux (tövsiyə olunur, həmişə aktual)
brew install opencode              # macOS və Linux (rəsmi brew formulu, daha az yenilənir)
sudo pacman -S opencode            # Arch Linux (Stabil)
paru -S opencode-bin               # Arch Linux (AUR-dan ən son)
mise use -g opencode               # İstənilən ƏS
nix run nixpkgs#opencode           # və ya ən son dev branch üçün github:anomalyco/opencode
```

> [!TIP]
> Quraşdırmadan əvvəl 0.1.x-dən köhnə versiyaları silin.

### Masaüstü tətbiqi (BETA)

OpenCode masaüstü tətbiqi olaraq da mövcuddur. Birbaşa [buraxılış səhifəsindən](https://github.com/anomalyco/opencode/releases) və ya [opencode.ai/download](https://opencode.ai/download) ünvanından yükləyə bilərsiniz.

| Platforma             | Yükləmə                              |
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

#### Quraşdırma qovluğu

Quraşdırma skripti quraşdırma yolu üçün aşağıdakı prioritet sırasına əməl edir:

1. `$OPENCODE_INSTALL_DIR` - Fərdi quraşdırma qovluğu
2. `$XDG_BIN_DIR` - XDG Base Directory Specification uyğun yol
3. `$HOME/bin` - Standart istifadəçi binar qovluğu (mövcuddursa və ya yaradıla bilirsə)
4. `$HOME/.opencode/bin` - Standart ehtiyat yer

```bash
# Nümunələr
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### Agentlər

OpenCode `Tab` düyməsi ilə aralarında keçid edə biləcəyiniz iki daxili agent daxildir.

- **build** - Standart, inkişaf işləri üçün tam girişli agent
- **plan** - Təhlil və kod araşdırması üçün yalnız oxuma agenti
  - Standart olaraq fayl redaktələrini rədd edir
  - Bash əmrlərini icra etməzdən əvvəl icazə istəyir
  - Tanımadığınız kod bazalarını araşdırmaq və ya dəyişiklikləri planlamaq üçün ideal

Həmçinin mürəkkəb axtarışlar və çoxaddımlı tapşırıqlar üçün **general** alt agent mövcuddur.
Bu daxili olaraq istifadə olunur və mesajlarda `@general` ilə çağırıla bilər.

[Agentlər](https://opencode.ai/docs/agents) haqqında daha çox öyrənin.

### Sənədlər

OpenCode-u necə konfiqurasiya edəcəyiniz haqqında daha çox məlumat üçün [**sənədlərimizə keçin**](https://opencode.ai/docs).

### Töhfə vermə

OpenCode-a töhfə vermək istəyirsinizsə, pull request göndərməzdən əvvəl [töhfə vermə sənədlərimizi](./CONTRIBUTING.md) oxuyun.

### OpenCode üzərində inkişaf

OpenCode ilə əlaqəli layihə üzərində işləyirsinizsə və layihənizin adının bir hissəsi olaraq "opencode" istifadə edirsinizsə (məsələn, "opencode-dashboard" və ya "opencode-mobile"), README faylınıza layihənin OpenCode komandası tərəfindən hazırlanmadığını və bizimlə heç bir əlaqəsi olmadığını bildirən qeyd əlavə edin.

### FAQ

#### Bu Claude Code-dan nə ilə fərqlənir?

Qabiliyyət baxımından Claude Code-a çox bənzəyir. Əsas fərqlər bunlardır:

- 100% açıq mənbəli
- Heç bir provayderə bağlı deyil. [OpenCode Zen](https://opencode.ai/zen) vasitəsilə təqdim etdiyimiz modelləri tövsiyə etsək də, OpenCode Claude, OpenAI, Google və ya hətta yerli modellərlə istifadə edilə bilər. Modellər inkişaf etdikcə aralarındakı fərqlər azalacaq və qiymətlər düşəcək, buna görə provayderdən asılı olmamaq vacibdir.
- Hazır LSP dəstəyi
- TUI yönümlü yanaşma. OpenCode neovim istifadəçiləri və [terminal.shop](https://terminal.shop) yaradıcıları tərəfindən hazırlanır; biz terminalda mümkün olanın hüdudlarını genişləndirəcəyik.
- Müştəri/server arxitekturası. Bu, məsələn, OpenCode-un kompüterinizdə işləməsini və siz onu mobil tətbiqdən uzaqdan idarə etməyinizi təmin edir. TUI interfeysi mümkün müştərilərdən yalnız biridir.

---

**İcmamıza qoşulun** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
