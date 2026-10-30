<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="Logótipo do OpenCode">
    </picture>
  </a>
</p>
<p align="center">O agente de IA open source para programação.</p>
<p align="center">
  <a href="https://opencode.ai/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/@opencode/cli"><img alt="npm" src="https://img.shields.io/npm/v/@opencode/cli?style=flat-square" /></a>
  <a href="https://github.com/anomalyco/opencode/actions/workflows/release.yml"><img alt="Estado da build" src="https://img.shields.io/github/actions/workflow/status/anomalyco/opencode/release.yml?style=flat-square&branch=dev" /></a>
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
  <a href="README.pt.md">Português (Portugal)</a> |
  <a href="README.th.md">ไทย</a> |
  <a href="README.tr.md">Türkçe</a> |
  <a href="README.uk.md">Українська</a> |
  <a href="README.bn.md">বাংলা</a> |
  <a href="README.gr.md">Ελληνικά</a> |
  <a href="README.vi.md">Tiếng Việt</a>
</p>

[![Interface do Terminal do OpenCode](packages/web/src/assets/lander/screenshot.png)](https://opencode.ai)

---

### Instalação

```bash
# YOLO
curl -fsSL https://opencode.ai/v2/install | bash

# Gestores de pacotes
npm i -g @opencode/cli@latest      # ou bun/pnpm/yarn
brew install anomalyco/tap/opencode-v2 # macOS e Linux (recomendado, sempre atualizado)
brew install opencode              # macOS e Linux (fórmula oficial do brew, atualizada com menos frequência)
sudo pacman -S opencode            # Arch Linux (Estável)
paru -S opencode-beta              # Arch Linux (Mais recente do AUR)
mise use -g opencode               # Qualquer SO
nix run github:anomalyco/opencode  # Nix
```

> [!TIP]
> Remova versões anteriores a 0.1.x antes de instalar.

### Aplicação para Desktop (BETA)

O OpenCode também está disponível como aplicação para desktop. Descarregue-a em [opencode.ai/download](https://opencode.ai/download).

| Plataforma            | Transferência                      |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `opencode-desktop-mac-x64.dmg`     |
| Windows               | `opencode-desktop-win-x64.exe`     |
| Linux                 | `.deb`, `.rpm`, ou `.AppImage`     |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
```

#### Diretório de Instalação

O script de instalação instala o OpenCode em `$HOME/.opencode/bin`.

### Agentes

O OpenCode inclui dois agentes integrados que pode alternar com a tecla `Tab`.

- **build** - Padrão, agente com acesso total para trabalho de desenvolvimento
- **plan** - Agente só de leitura para análise e exploração de código
  - Nega edições de ficheiros por defeito
  - Solicita permissão antes de executar comandos bash
  - Ideal para explorar bases de código desconhecidas ou planear alterações

Também está incluído um subagente **general** para pesquisas complexas e tarefas com vários passos.
Este é utilizado internamente e pode ser invocado com `@general` nas mensagens.

Saiba mais sobre [agentes](https://opencode.ai/v2/docs/agents).

### Documentação

Para mais informações sobre como configurar o OpenCode, [**consulte a nossa documentação**](https://opencode.ai/v2/docs).

### Contribuir

Se estiver interessado em contribuir para o OpenCode, leia a nossa [documentação de contribuição](./CONTRIBUTING.md) antes de submeter um pedido de integração (pull request).

### Construir com base no OpenCode

Se estiver a trabalhar num projeto relacionado com o OpenCode e que utiliza "opencode" no nome, por exemplo "opencode-dashboard" ou "opencode-mobile", adicione uma nota ao seu README a clarificar que não foi criado pela equipa do OpenCode e que não existe qualquer afiliação connosco.

---

**Junte-se à nossa comunidade** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
