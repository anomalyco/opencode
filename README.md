<p align="center">
  <a href="https://github.com/jaminsmoke/Jarvis">
    <img src="packages/desktop/icons/prod/1024x1024.png" alt="Jarvis logo" width="160">
  </a>
</p>
<p align="center"><strong>Jarvis</strong> — your personal AI assistant.</p>
<p align="center">
  <a href="https://github.com/jaminsmoke/Jarvis/releases"><img alt="Releases" src="https://img.shields.io/github/v/release/jaminsmoke/Jarvis?style=flat-square" /></a>
  <a href="https://github.com/jaminsmoke/Jarvis"><img alt="License" src="https://img.shields.io/github/license/jaminsmoke/Jarvis?style=flat-square" /></a>
  <a href="https://github.com/jaminsmoke/Jarvis/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/jaminsmoke/Jarvis?style=flat-square" /></a>
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

[![Jarvis Desktop](packages/web/src/assets/lander/screenshot.png)](https://github.com/jaminsmoke/Jarvis)

---

### Installation

**Jarvis Desktop (Windows)**

Download the latest installer from the [releases page](https://github.com/jaminsmoke/Jarvis/releases).

| Platform               | Download                                    |
| ---------------------- | ------------------------------------------- |
| Windows x64            | `jarvis-desktop-win-x64.exe`                |
| Linux                  | `.deb`, `.rpm`, or `.AppImage`              |
| macOS (Apple Silicon)  | `jarvis-desktop-mac-arm64.dmg`              |
| macOS (Intel)          | `jarvis-desktop-mac-x64.dmg`                |

**From source**

```bash
git clone https://github.com/jaminsmoke/Jarvis.git
cd Jarvis
bun install
bun --cwd packages/desktop dev                # run the desktop app in dev mode
bun --cwd packages/desktop run package:win    # build the Windows installer (dist/)
```

### Agents

Jarvis includes two built-in agents you can switch between with the `Tab` key.

- **build** - Default, full-access agent for development work
- **plan** - Read-only agent for analysis and code exploration
  - Denies file edits by default
  - Asks permission before running bash commands
  - Ideal for exploring unfamiliar codebases or planning changes

Also included is a **general** subagent for complex searches and multistep tasks.
This is used internally and can be invoked using `@general` in messages.

Learn more about [agents](https://opencode.ai/docs/agents).

### Documentation

Jarvis is a fork of [OpenCode](https://opencode.ai), so most of the [**OpenCode documentation**](https://opencode.ai/docs) applies to Jarvis.

### Contributing

If you're interested in contributing to Jarvis, please read our [contributing docs](./CONTRIBUTING.md) before submitting a pull request.

### Fork of OpenCode

Jarvis is a fork of [OpenCode](https://opencode.ai), the open source AI coding agent. It is an independent project and is not affiliated with the OpenCode team.

Third-party services such as **OpenCode Zen** and the **free models provided by OpenCode** remain available inside Jarvis.

---

**Project links** [GitHub](https://github.com/jaminsmoke/Jarvis) · [Releases](https://github.com/jaminsmoke/Jarvis/releases)
