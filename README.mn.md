<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center">Нээлттэй эх бүхий AI туслах.</p>
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
  <a href="README.mn.md">Монгол</a>
</p>

[![OpenCode Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://opencode.ai)

---

### Суулгах заавар

```bash
# YOLO
curl -fsSL https://opencode.ai/install | bash

# Багц менежерүүд
npm i -g opencode-ai@latest        # эсвэл bun/pnpm/yarn
scoop install opencode             # Windows
choco install opencode             # Windows
brew install anomalyco/tap/opencode # macOS болон Linux (зөвлөмж, үргэлж шинэчлэгдэж байна)
brew install opencode               # macOS болон Linux (албан ёсны brew formula, цөөн шинэчлэлтэй)
sudo pacman -S opencode             # Arch Linux (Тогтвортой)
paru -S opencode-bin                # Arch Linux (AUR-ийн хамгийн сүүлийн хувилбар)
mise use -g opencode                # Ямар ч OS дээр
nix run nixpkgs#opencode            # эсвэл github:anomalyco/opencode нь хамгийн сүүлийн dev хувилбар
```

> [!TIP]
> Суулгахаасаа өмнө 0.1.x-ээс өмнөх хувилбарыг устгана уу.

### Desktop application (BETA)

OpenCode нь мөн desktop програм хэлбэрээр суух боломжтой болсон. [releases page](https://github.com/anomalyco/opencode/releases)-с шууд татах эсвэл [opencode.ai/download](https://opencode.ai/download)-ийг ашиглана уу.

| Платформ              | Татах файл                            |
| --------------------- | ------------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-darwin-aarch64.dmg` |
| macOS (Intel)         | `opencode-desktop-darwin-x64.dmg`     |
| Windows               | `opencode-desktop-windows-x64.exe`    |
| Linux                 | `.deb`, `.rpm`, эсвэл AppImage        |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop
```

#### Суулгах директор

Суулгах скрипт нь дараах давуу эрэмбээр суулгах замтай тохирно:

1. `$OPENCODE_INSTALL_DIR` - Захиалгат суулгах директор
2. `$XDG_BIN_DIR` - XDG Base Directory Specification стандарт зам
3. `$HOME/bin` - Стандарт хэрэглэгчийн binary директор (өмнө нь байсан эсвэл шинээр үүсгэж болно)
4. `$HOME/.opencode/bin` - Анхны fallback

```bash
# Жишээ
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### Агентууд

OpenCode нь `Tab` товчоор сольж болох 2 дотоод агентай.

- **build** - Анхны тохиргоо, хөгжүүлэлтийн ажилд зориулсан бүрэн хандалттай агент
- **plan** - Шинжилгээ болон код судлахад зориулсан зөвхөн унших агент
  - Анхны тохиргоонд файл засвар хийхээс татгалзана
  - bash тушаал ажиллуулахаасаа өмнө зөвшөөрөл асууна
  - Танил бус кодын санг судлахад эсвэл өөрчлөлт төлөвлөхөд тохиромжтой

Мөн олон алхамт хайлт болон нийлмэл даалгаварт зориулсан **general** дэд агент багтсан.
Дотодоо ашиглагдаж, `@general`-ээр дуудаж болно.

[Агентууд](https://opencode.ai/docs/agents)-ийн талаар илүү ихийг мэдэж аваарай.

### Баримт бичиг

OpenCode-ийг тохируулах талаар дэлгэрэнгүй мэдээлэл авахын тулд [**баримт бичиг**](https://opencode.ai/docs)-рүү орно уу.

### Хувь нэмрээ оруулах

OpenCode-д хувь нэмрээ оруулахыг хүсвэл, Pull Request илгээхээс өмнө [contributing docs](./CONTRIBUTING.md)-ийг уншина уу.

### OpenCode-ийн түүхэн дээр барих

OpenCode-тэй холбоотой төсөл дээр ажиллаж, нэрэндээ "opencode" (жишээ нь "opencode-dashboard" эсвэл "opencode-mobile")-ийг ашиглаж байгаа бол README-д энэ нь OpenCode багт хийсэн биш, ямар ч хэлбэрээр бидэнтэй холбоотой бус гэдгийг тодотгоно уу.

### FAQ

#### Энэ нь Claude Code-оос ямар ялгаатай вэ?

Чиглэлийн хувьд Claude Code-тэй маш төстэй. Үндсэн ялгаа нь:

- 100% нээлттэй эх
- Ямар ч үйлчилгээ үзүүлэгчид холбогдоогүй. Бид [OpenCode Zen](https://opencode.ai/zen)-ээр дамжуулан санал болгож буй моделүүдийг зөвлөж байгаа боловч, OpenCode-ийг Claude, OpenAI, Google эсвэл локал моделтай хамт ашиглаж болно. Моделүүд хөгжих тусам хоорондын зөрүү багасч, үнэ буурна, тиймээс үйлчилгээ үзүүлэгчөөс хамааралгүй байх нь чухал.
- Анхнаас LSP дэмжлэгтэй
- TUI руу чиглэсэн. OpenCode-ийг neovim хэрэглэгчид болон [terminal.shop](https://terminal.shop)-ийг үүсгэгчид бүтээсэн бөгөөд терминалд боломжтой зүйлийн хязгаарыг түлхэн хөгжүүлэх болно.
- Клиент/сервер архитектур. Жишээлбэл, OpenCode-ийг таны компьютерт ажиллуулаад, гар утасны аппликейшнээр алсын зайнаас удирдах боломжтой. Өөрөөр хэлбэл, TUI frontend бол зөвхөн боломжтой олон клиентүүдийн нэг юм.

---

**Нэгдэгт нь оршино уу** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
