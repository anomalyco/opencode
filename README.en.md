<p align="center">
  <img src="docs/assets/branding/logo-horizontal.svg" alt="DeskFox.Ai" width="420">
</p>

<p align="center"><strong>Desktop AI assistant for office users</strong></p>

<p align="center"><sub>CLEVER · CALM · ALWAYS ON YOUR DESK</sub></p>

<p align="center">
  <a href="https://github.com/zoulukuang/deskfox/releases/latest">📥 Download</a>
  &nbsp;·&nbsp;
  <a href="https://deskfox.ai/">🏠 Website</a>
  &nbsp;·&nbsp;
  <a href="README.md">🇨🇳 中文</a>
</p>

<p align="center">
  <a href="https://github.com/zoulukuang/deskfox/releases"><img src="https://img.shields.io/github/v/release/zoulukuang/deskfox?display_name=tag&label=latest&style=flat-square" alt="latest release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="MIT" /></a>
  <a href="https://github.com/sst/opencode"><img src="https://img.shields.io/badge/forked%20from-sst%2Fopencode-black?style=flat-square" alt="forked from sst/opencode" /></a>
</p>

---

> Email drafts, report rewrites, Excel formulas, PDF reading, PPT outlines — all the repetitive office work, just talk to DeskFox.

<p align="center">
  <img src="docs/assets/screenshots/hero.png" alt="DeskFox main UI — three-pane: project sidebar + chat panel + file tree" width="900">
</p>

## ✨ Why DeskFox

- 🔓 **Open & local-first** — All code public, your data stays on your machine
- 🌍 **From the sst/opencode community** — Forked from a project audited daily by global developers; our job is to translate it for office users
- 🎁 **Zero-setup onboarding** — OpenCode Zen free models (MiniMax / Hy3 / Nemotron) bundled — install and chat. No top-up, no API signup
- 🤖 **One-click model switching** — Claude / GPT / Gemini / Chinese models + Zen gateway, all in one UI; your API keys stay on your machine

## 🎯 Use cases

| Scenario | What you can do |
|---|---|
| 📄 **Document companion** | Preview Word / Excel / PDF / Markdown directly, attach to chat, ask AI to rewrite / summarize / answer |
| ✍️ **Drafting** | Emails / weekly reports / meeting notes / contract drafts — give the gist, AI drafts the full text |
| 📊 **Data work** | Excel formulas / CSV cleanup / pivot logic / simple visualization |
| 🔐 **Privacy-sensitive** | Files never leave your machine; chat history stored locally; API keys talk directly to model providers, no third-party relay |

## 🖼️ File preview

Beyond chat, DeskFox **previews diverse file formats right in the main UI** — one click to attach to the current conversation:

<table>
  <tr>
    <td align="center" width="33%">
      <img src="docs/assets/screenshots/preview-pdf.png" alt="PDF preview" width="280"><br>
      <sub><b>📄 PDF / Word / Markdown</b><br>Original layout + extracted text</sub>
    </td>
    <td align="center" width="33%">
      <img src="docs/assets/screenshots/preview-pptx.png" alt="PowerPoint preview" width="280"><br>
      <sub><b>📊 Excel / PowerPoint</b><br>Sheets and slides rendered inline</sub>
    </td>
    <td align="center" width="33%">
      <img src="docs/assets/screenshots/preview-video.png" alt="Video preview" width="280"><br>
      <sub><b>🎬 Video / Audio / Image</b><br>Built-in media player</sub>
    </td>
  </tr>
</table>

Right-click any file tab → "Add to chat" to drop its content into the current conversation — ask the AI to explain, rewrite, or summarize.

## 📥 Download

| Platform | Global (GitHub) | China mirror (Gitee) |
|---|---|---|
| **Windows** | [releases/latest](https://github.com/zoulukuang/deskfox/releases/latest) | [Gitee Release](https://gitee.com/zoulukuang/deskfox/releases/) |
| **macOS (Apple Silicon)** | [releases/latest](https://github.com/zoulukuang/deskfox/releases/latest) | [Gitee Release](https://gitee.com/zoulukuang/deskfox/releases/) |

> **First-launch note** (this fork project does not yet have a code-signing certificate — **not malware**):
> - **Windows**: SmartScreen warns → "More info" → "Run anyway"
> - **macOS**: Gatekeeper blocks → right-click app icon → "Open" → confirm once
>
> Background: [`docs/governance/数字签名问题.md`](docs/governance/数字签名问题.md)

## 🌱 Project provenance

**DeskFox.Ai** is a fork of [`sst/opencode`](https://github.com/sst/opencode). The upstream is an AI coding tool for developers; we forked it and **repositioned it as a daily AI work companion for office users**. We've done:

- 🎨 **UI simplification** — removed coding-specific surfaces, reorganized chat and file operations
- 🦊 **Brand rebuild** — DeskFox visual identity (Bundle ID / icons / copy), zero namespace overlap with upstream
- 📄 **Document preview** — Word / Excel / PDF / Markdown previewable in-app, one-click "add to chat" for context
- 📦 **Engineered packaging** — Windows + macOS triple-env (prod / beta / dev) builds, GitHub Actions automated release, Gitee mirror sync

Full change index: [`改动日志.md`](改动日志.md) · Governance: [`docs/governance/`](docs/governance/) · Upstream-merge SOP: [`docs/governance/UPSTREAM-MERGE-GUIDE.md`](docs/governance/UPSTREAM-MERGE-GUIDE.md)

## 🌐 Links

| | |
|---|---|
| 🏠 Website | [deskfox.ai](https://deskfox.ai/) |
| 📦 GitHub Release | [releases/latest](https://github.com/zoulukuang/deskfox/releases/latest) |
| 🇨🇳 Gitee mirror | [zoulukuang/deskfox](https://gitee.com/zoulukuang/deskfox) |
| 🐛 Issues | [github.com/zoulukuang/deskfox/issues](https://github.com/zoulukuang/deskfox/issues) |
| 🔒 Privacy policy | [English](docs/legal/PRIVACY.md) · [中文](docs/legal/隐私协议.md) |
| ⬆️ Upstream | [sst/opencode](https://github.com/sst/opencode) |

## 📄 License

[MIT](LICENSE) — same as upstream [`sst/opencode`](https://github.com/sst/opencode). All changes are public on GitHub, and we follow upstream upgrades.

---

<p align="center"><sub>© 2026 DeskFox.Ai · MIT-licensed · forked from sst/opencode</sub></p>
