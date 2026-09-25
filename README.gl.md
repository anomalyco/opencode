<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center">O axente de programación con IA de código aberto.</p>
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
  <a href="README.es.md">Castelán</a> |
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
  <a href="README.gl.md">Galego</a>
</p>

[![OpenCode Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://opencode.ai)

---

### Instalación

```bash
# YOLO
curl -fsSL https://opencode.ai/install | bash

# Xestores de paquetes
npm i -g opencode-ai@latest        # ou bun/pnpm/yarn
scoop install opencode             # Windows
choco install opencode             # Windows
brew install anomalyco/tap/opencode # macOS e Linux (recomendado, sempre ao día)
brew install opencode              # macOS e Linux (fórmula oficial de brew, actualízase menos)
sudo pacman -S opencode            # Arch Linux (Estable)
paru -S opencode-bin               # Arch Linux (Última versión desde AUR)
mise use -g opencode               # Calquera SO
nix run nixpkgs#opencode           # ou github:anomalyco/opencode para a última póla dev
```

> [!TIP]
> Elimine as versións anteriores a 0.1.x antes de instalar.

### Aplicación de escritorio (BETA)

OpenCode tamén está dispoñible como aplicación de escritorio. Descárguea directamente desde a [páxina de versións](https://github.com/anomalyco/opencode/releases) ou desde [opencode.ai/download](https://opencode.ai/download).

| Plataforma            | Descarga                           |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `opencode-desktop-mac-x64.dmg`     |
| Windows               | `opencode-desktop-windows-x64.exe` |
| Linux                 | `.deb`, `.rpm` ou `.AppImage`     |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop
```

#### Directorio de instalación

O script de instalación respecta a seguinte orde de prioridade para a ruta de instalación:

1. `$OPENCODE_INSTALL_DIR` - Directorio de instalación personalizado
2. `$XDG_BIN_DIR` - Ruta conforme á especificación XDG Base Directory
3. `$HOME/bin` - Directorio binario estándar do usuario (se existe ou pode crearse)
4. `$HOME/.opencode/bin` - Alternativa predeterminada

```bash
# Exemplos
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### Axentes

OpenCode inclúe dous axentes integrados entre os que pode alternar coa tecla `Tab`.

- **build** - Axente predeterminado con acceso completo para tarefas de desenvolvemento
- **plan** - Axente de só lectura para análise e exploración de código
  - Denega a edición de ficheiros por omisión
  - Pide permiso antes de executar ordes de bash
  - Ideal para explorar bases de código descoñecidas ou planificar cambios

Tamén se inclúe un subaxente **general** para procuras complexas e tarefas de varios pasos.
Úsase internamente e pode invocarse mediante `@general` nas mensaxes.

Máis información sobre os [axentes](https://opencode.ai/docs/agents).

### Documentación

Para obter máis información sobre como configurar OpenCode, [**visite a nosa documentación**](https://opencode.ai/docs).

### Contribuír

Se ten interese en contribuír a OpenCode, lea a nosa [documentación de contribución](./CONTRIBUTING.md) antes de enviar unha solicitude de extracción (pull request).

### Proxectos baseados en OpenCode

Se está a traballar nun proxecto relacionado con OpenCode e utiliza "opencode" como parte do seu nome, por exemplo "opencode-dashboard" ou "opencode-mobile", engada unha nota no seu README para aclarar que non está desenvolvido polo equipo de OpenCode e non está afiliado connosco de ningún xeito.

---

**Únase á nosa comunidade** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
