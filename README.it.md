<p align="center">
  <a href="https://cyberstrike.io">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="Logo CyberStrike">
    </picture>
  </a>
</p>
<p align="center">L’agente di coding AI open source.</p>
<p align="center">
  <a href="https://cyberstrike.io/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/cyberstrike-ai"><img alt="npm" src="https://img.shields.io/npm/v/cyberstrike-ai?style=flat-square" /></a>
  <a href="https://github.com/CyberStrikeus/cyberstrike/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/CyberStrikeus/cyberstrike/publish.yml?style=flat-square&branch=dev" /></a>
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
  <a href="README.ar.md">العربية</a> |
  <a href="README.no.md">Norsk</a> |
  <a href="README.br.md">Português (Brasil)</a> |
  <a href="README.th.md">ไทย</a> |
  <a href="README.tr.md">Türkçe</a>
</p>

[![CyberStrike Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://cyberstrike.io)

---

### Installazione

```bash
# YOLO
curl -fsSL https://cyberstrike.io/install | bash

# Package manager
npm i -g cyberstrike-ai@latest        # oppure bun/pnpm/yarn
scoop install cyberstrike             # Windows
choco install cyberstrike             # Windows
brew install CyberStrikeus/tap/cyberstrike # macOS e Linux (consigliato, sempre aggiornato)
brew install cyberstrike              # macOS e Linux (formula brew ufficiale, aggiornata meno spesso)
sudo pacman -S cyberstrike            # Arch Linux (Stable)
paru -S cyberstrike-bin               # Arch Linux (Latest from AUR)
mise use -g cyberstrike               # Qualsiasi OS
nix run nixpkgs#cyberstrike           # oppure github:CyberStrikeus/cyberstrike per l’ultima branch di sviluppo
```

> [!TIP]
> Rimuovi le versioni precedenti alla 0.1.x prima di installare.

### App Desktop (BETA)

CyberStrike è disponibile anche come applicazione desktop. Puoi scaricarla direttamente dalla [pagina delle release](https://github.com/CyberStrikeus/cyberstrike/releases) oppure da [cyberstrike.io/download](https://cyberstrike.io/download).

| Piattaforma           | Download                              |
| --------------------- | ------------------------------------- |
| macOS (Apple Silicon) | `cyberstrike-desktop-darwin-aarch64.dmg` |
| macOS (Intel)         | `cyberstrike-desktop-darwin-x64.dmg`     |
| Windows               | `cyberstrike-desktop-windows-x64.exe`    |
| Linux                 | `.deb`, `.rpm`, oppure AppImage       |

```bash
# macOS (Homebrew)
brew install --cask cyberstrike-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/cyberstrike-desktop
```

#### Directory di installazione

Lo script di installazione rispetta il seguente ordine di priorità per il percorso di installazione:

1. `$CYBERSTRIKE_INSTALL_DIR` – Directory di installazione personalizzata
2. `$XDG_BIN_DIR` – Percorso conforme alla XDG Base Directory Specification
3. `$HOME/bin` – Directory binaria standard dell’utente (se esiste o può essere creata)
4. `$HOME/.cyberstrike/bin` – Fallback predefinito

```bash
# Esempi
CYBERSTRIKE_INSTALL_DIR=/usr/local/bin curl -fsSL https://cyberstrike.io/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://cyberstrike.io/install | bash
```

### Agenti

CyberStrike include due agenti integrati tra cui puoi passare usando il tasto `Tab`.

- **build** – Predefinito, agente con accesso completo per il lavoro di sviluppo
- **plan** – Agente in sola lettura per analisi ed esplorazione del codice
  - Nega le modifiche ai file per impostazione predefinita
  - Chiede il permesso prima di eseguire comandi bash
  - Ideale per esplorare codebase sconosciute o pianificare modifiche

È inoltre incluso un sotto-agente **general** per ricerche complesse e attività multi-step.
Viene utilizzato internamente e può essere invocato usando `@general` nei messaggi.

Scopri di più sugli [agenti](https://cyberstrike.io/docs/agents).

### Documentazione

Per maggiori informazioni su come configurare CyberStrike, [**consulta la nostra documentazione**](https://cyberstrike.io/docs).

### Contribuire

Se sei interessato a contribuire a CyberStrike, leggi la nostra [guida alla contribuzione](./CONTRIBUTING.md) prima di inviare una pull request.

### Costruire su CyberStrike

Se stai lavorando a un progetto correlato a CyberStrike e che utilizza “cyberstrike” come parte del nome (ad esempio “cyberstrike-dashboard” o “cyberstrike-mobile”), aggiungi una nota nel tuo README per chiarire che non è sviluppato dal team CyberStrike e che non è affiliato in alcun modo con noi.

### FAQ

#### In cosa è diverso da Claude Code?

È molto simile a Claude Code in termini di funzionalità. Ecco le principali differenze:

- 100% open source
- Non è legato a nessun provider. Anche se consigliamo i modelli forniti tramite [CyberStrike Zen](https://cyberstrike.io/zen), CyberStrike può essere utilizzato con Claude, OpenAI, Google o persino modelli locali. Con l’evoluzione dei modelli, le differenze tra di essi si ridurranno e i prezzi scenderanno, quindi essere indipendenti dal provider è importante.
- Supporto LSP pronto all’uso
- Forte attenzione alla TUI. CyberStrike è sviluppato da utenti neovim e dai creatori di [terminal.shop](https://terminal.shop); spingeremo al limite ciò che è possibile fare nel terminale.
- Architettura client/server. Questo, ad esempio, permette a CyberStrike di girare sul tuo computer mentre lo controlli da remoto tramite un’app mobile. La frontend TUI è quindi solo uno dei possibili client.

---

**Unisciti alla nostra community** [Discord](https://discord.gg/cyberstrike) | [X.com](https://x.com/cyberstrike)
