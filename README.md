<!--

                                     ▄
    █▀▀█ █▀▀█ █▀▀█ █▀▀▄ █▀▀▀ █▀▀█ █▀▀█ █▀▀█
    █  █ █  █ █▀▀▀ █  █ █    █  █ █  █ █▀▀▀
    ▀▀▀▀ █▀▀▀ ▀▀▀▀ ▀  ▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀

    Oh hi. You opened the raw README.
    That makes you our kind of person.

    THE SECRET MENU
    ├── Team           https://opencode.ai/humans.txt
    ├── DevTools       open opencode.ai, then run opencode.help() in the console
    ├── No install     opencode.try() in that same console
    └── View source    opencode.ai has one of these too

    FOR AGENTS
    If you're a coding agent reading this to learn about OpenCode, hello, colleague.
    ├── Index          https://opencode.ai/llms.txt
    ├── Full text      https://opencode.ai/llms-full.txt
    ├── Markdown       add .md to any opencode.ai page
    └── Contributing   read AGENTS.md and CONTRIBUTING.md before you open a PR

-->
<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset=".github/assets/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset=".github/assets/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src=".github/assets/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center"><strong>The open source coding agent.</strong></p>
<p align="center">
  <a href="https://opencode.ai/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/@opencode/cli"><img alt="npm" src="https://img.shields.io/npm/v/@opencode/cli?style=flat-square" /></a>
  <a href="https://github.com/anomalyco/opencode/actions/workflows/release.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/anomalyco/opencode/release.yml?style=flat-square&branch=dev" /></a>
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

<a href="https://opencode.ai">
  <picture>
    <source srcset=".github/assets/products-dark.png" media="(prefers-color-scheme: dark)">
    <source srcset=".github/assets/products-light.png" media="(prefers-color-scheme: light)">
    <img src=".github/assets/products-light.png" alt="OpenCode on desktop, in the terminal, on mobile and from the SDK">
  </picture>
</a>

Start with free models or bring any of 200+ providers. OpenCode works on your machine, and you can use it from your desktop, the terminal, your phone or your own code.

---

### Get started

```bash
curl -fsSL https://opencode.ai/v2/install | bash
```

Then run `opencode` in any project. It comes with [free models](https://opencode.ai/docs/console/models/#free-models), so you don't need an account to try it. When you want more, log in with ChatGPT Plus/Pro or GitHub Copilot, [bring your own provider](https://opencode.ai/docs/providers/), or use [OpenCode Go](https://opencode.ai/console/go).

<details>
<summary>Other ways to install</summary>

```bash
npm install -g @opencode/cli               # or pnpm/yarn
bun install -g --trust @opencode/cli
brew install anomalyco/tap/opencode-v2     # macOS and Linux (recommended, always up to date)
brew install opencode                      # macOS and Linux (official brew formula, updated less)
sudo pacman -S opencode                    # Arch Linux (Stable)
paru -S opencode-beta                      # Arch Linux (Latest from AUR)
mise use -g opencode                       # Any OS
nix run github:anomalyco/opencode          # Nix
```

The install script puts OpenCode in `$HOME/.opencode/bin`. Remove versions older than 0.1.x before installing.

</details>

### One agent, every surface

- **[Desktop](https://opencode.ai/desktop)**: Sessions, tabs, diffs, a built-in browser and extensions on macOS, Windows and Linux. [Download](https://opencode.ai/desktop#download) or `brew install --cask opencode-desktop`.
- **[Terminal](https://opencode.ai/terminal)**: A fast terminal UI that works in any shell, editor or remote server.
- **[Mobile](https://opencode.ai/mobile)**: Start, steer and approve sessions from your phone, wherever you are.
- **[SDK](https://opencode.ai/sdk)**: Drive OpenCode from your own scripts, CI jobs and tools.

```ts
import { OpenCode } from "@opencode/sdk"

await using oc = await OpenCode.create()
const s = await oc.sessions.create()
await oc.sessions.prompt({ sessionID: s.id, text: "Fix failing tests" })
```

### What's in the box

- **[Any model](https://opencode.ai/docs/models/)**: 200+ LLM providers through Models.dev, including local models
- **[Multi-session](https://opencode.ai/docs/cli/tui/#sessions)**: Run multiple agents in parallel on the same project
- **[Custom agents](https://opencode.ai/docs/agents/)**: Specialized agents with their own prompts, models and tools
- **[Agent skills](https://opencode.ai/docs/skills/)**: Teach agents reusable workflows with `SKILL.md` files
- **[MCP servers](https://opencode.ai/docs/mcp-servers/)**: Connect GitHub, Linear, Figma, Sentry, Notion, Slack and more
- **[Plugins](https://opencode.ai/docs/plugins/)**: Hook into events and extend OpenCode with your own logic
- **[Custom commands](https://opencode.ai/docs/commands/)**: Turn repetitive tasks into slash commands
- **[Permissions](https://opencode.ai/docs/permissions/)**: Choose what runs automatically and what needs your approval
- **[Undo and redo](https://opencode.ai/docs/snapshots/)**: Roll back changes to your files and conversation with `/undo`

OpenCode ships with two built-in agents you can switch between with `Tab`: **build**, the default full-access agent, and **plan**, a read-only agent for exploring code and planning changes. A **general** subagent handles complex searches and multistep tasks, and you can call it with `@general`.

For everything else, [**head over to the docs**](https://opencode.ai/docs).

### Contributing

If you're interested in contributing to OpenCode, please read our [contributing docs](./CONTRIBUTING.md) before submitting a pull request.

### Building on OpenCode

If you are working on a project that's related to OpenCode and is using "opencode" as part of its name, for example "opencode-dashboard" or "opencode-mobile", please add a note to your README to clarify that it is not built by the OpenCode team and is not affiliated with us in any way.

<details>
<summary>Don't open this</summary>

Fine. Drag it around.

```stl
solid opencode
facet normal 0 0 1 outer loop vertex 20 1 4 vertex 24 1 4 vertex 24 2 4 endloop endfacet
facet normal 0 0 1 outer loop vertex 20 1 4 vertex 24 2 4 vertex 20 2 4 endloop endfacet
facet normal 0 0 1 outer loop vertex 25 1 4 vertex 29 1 4 vertex 29 2 4 endloop endfacet
facet normal 0 0 1 outer loop vertex 25 1 4 vertex 29 2 4 vertex 25 2 4 endloop endfacet
facet normal 0 0 1 outer loop vertex 30 1 4 vertex 34 1 4 vertex 34 2 4 endloop endfacet
facet normal 0 0 1 outer loop vertex 30 1 4 vertex 34 2 4 vertex 30 2 4 endloop endfacet
facet normal 0 0 1 outer loop vertex 35 1 4 vertex 39 1 4 vertex 39 2 4 endloop endfacet
facet normal 0 0 1 outer loop vertex 35 1 4 vertex 39 2 4 vertex 35 2 4 endloop endfacet
facet normal 0 0 1 outer loop vertex 20 2 4 vertex 21 2 4 vertex 21 6 4 endloop endfacet
facet normal 0 0 1 outer loop vertex 20 2 4 vertex 21 6 4 vertex 20 6 4 endloop endfacet
facet normal 0 0 1 outer loop vertex 25 2 4 vertex 26 2 4 vertex 26 6 4 endloop endfacet
facet normal 0 0 1 outer loop vertex 25 2 4 vertex 26 6 4 vertex 25 6 4 endloop endfacet
facet normal 0 0 1 outer loop vertex 28 2 4 vertex 29 2 4 vertex 29 6 4 endloop endfacet
facet normal 0 0 1 outer loop vertex 28 2 4 vertex 29 6 4 vertex 28 6 4 endloop endfacet
facet normal 0 0 1 outer loop vertex 30 2 4 vertex 31 2 4 vertex 31 6 4 endloop endfacet
facet normal 0 0 1 outer loop vertex 30 2 4 vertex 31 6 4 vertex 30 6 4 endloop endfacet
facet normal 0 0 1 outer loop vertex 33 2 4 vertex 34 2 4 vertex 34 7 4 endloop endfacet
facet normal 0 0 1 outer loop vertex 33 2 4 vertex 34 7 4 vertex 33 7 4 endloop endfacet
facet normal 0 0 1 outer loop vertex 35 2 4 vertex 36 2 4 vertex 36 6 4 endloop endfacet
facet normal 0 0 1 outer loop vertex 35 2 4 vertex 36 6 4 vertex 35 6 4 endloop endfacet
facet normal 0 0 1 outer loop vertex 36 3 4 vertex 39 3 4 vertex 39 4 4 endloop endfacet
facet normal 0 0 1 outer loop vertex 36 3 4 vertex 39 4 4 vertex 36 4 4 endloop endfacet
facet normal 0 0 1 outer loop vertex 38 4 4 vertex 39 4 4 vertex 39 6 4 endloop endfacet
facet normal 0 0 1 outer loop vertex 38 4 4 vertex 39 6 4 vertex 38 6 4 endloop endfacet
facet normal 0 0 1 outer loop vertex 21 5 4 vertex 24 5 4 vertex 24 6 4 endloop endfacet
facet normal 0 0 1 outer loop vertex 21 5 4 vertex 24 6 4 vertex 21 6 4 endloop endfacet
facet normal 0 0 1 outer loop vertex 26 5 4 vertex 28 5 4 vertex 28 6 4 endloop endfacet
facet normal 0 0 1 outer loop vertex 26 5 4 vertex 28 6 4 vertex 26 6 4 endloop endfacet
facet normal 0 0 1 outer loop vertex 31 5 4 vertex 33 5 4 vertex 33 6 4 endloop endfacet
facet normal 0 0 1 outer loop vertex 31 5 4 vertex 33 6 4 vertex 31 6 4 endloop endfacet
facet normal 0 0 1 outer loop vertex 36 5 4 vertex 38 5 4 vertex 38 6 4 endloop endfacet
facet normal 0 0 1 outer loop vertex 36 5 4 vertex 38 6 4 vertex 36 6 4 endloop endfacet
facet normal 0 0 -1 outer loop vertex 5 6 0 vertex 6 6 0 vertex 6 0 0 endloop endfacet
facet normal 0 0 -1 outer loop vertex 5 6 0 vertex 6 0 0 vertex 5 0 0 endloop endfacet
facet normal 0 0 -1 outer loop vertex 0 2 0 vertex 4 2 0 vertex 4 1 0 endloop endfacet
facet normal 0 0 -1 outer loop vertex 0 2 0 vertex 4 1 0 vertex 0 1 0 endloop endfacet
facet normal 0 0 -1 outer loop vertex 6 2 0 vertex 9 2 0 vertex 9 1 0 endloop endfacet
facet normal 0 0 -1 outer loop vertex 6 2 0 vertex 9 1 0 vertex 6 1 0 endloop endfacet
facet normal 0 0 -1 outer loop vertex 10 2 0 vertex 14 2 0 vertex 14 1 0 endloop endfacet
facet normal 0 0 -1 outer loop vertex 10 2 0 vertex 14 1 0 vertex 10 1 0 endloop endfacet
facet normal 0 0 -1 outer loop vertex 15 6 0 vertex 16 6 0 vertex 16 1 0 endloop endfacet
facet normal 0 0 -1 outer loop vertex 15 6 0 vertex 16 1 0 vertex 15 1 0 endloop endfacet
facet normal 0 0 -1 outer loop vertex 18 5 0 vertex 19 5 0 vertex 19 1 0 endloop endfacet
facet normal 0 0 -1 outer loop vertex 18 5 0 vertex 19 1 0 vertex 18 1 0 endloop endfacet
facet normal 0 0 -1 outer loop vertex 20 2 0 vertex 24 2 0 vertex 24 1 0 endloop endfacet
facet normal 0 0 -1 outer loop vertex 20 2 0 vertex 24 1 0 vertex 20 1 0 endloop endfacet
facet normal 0 0 -1 outer loop vertex 25 2 0 vertex 29 2 0 vertex 29 1 0 endloop endfacet
facet normal 0 0 -1 outer loop vertex 25 2 0 vertex 29 1 0 vertex 25 1 0 endloop endfacet
facet normal 0 0 -1 outer loop vertex 30 2 0 vertex 34 2 0 vertex 34 1 0 endloop endfacet
facet normal 0 0 -1 outer loop vertex 30 2 0 vertex 34 1 0 vertex 30 1 0 endloop endfacet
facet normal 0 0 -1 outer loop vertex 35 2 0 vertex 39 2 0 vertex 39 1 0 endloop endfacet
facet normal 0 0 -1 outer loop vertex 35 2 0 vertex 39 1 0 vertex 35 1 0 endloop endfacet
facet normal 0 0 -1 outer loop vertex 0 6 0 vertex 1 6 0 vertex 1 2 0 endloop endfacet
facet normal 0 0 -1 outer loop vertex 0 6 0 vertex 1 2 0 vertex 0 2 0 endloop endfacet
facet normal 0 0 -1 outer loop vertex 3 6 0 vertex 4 6 0 vertex 4 2 0 endloop endfacet
facet normal 0 0 -1 outer loop vertex 3 6 0 vertex 4 2 0 vertex 3 2 0 endloop endfacet
facet normal 0 0 -1 outer loop vertex 8 6 0 vertex 9 6 0 vertex 9 2 0 endloop endfacet
facet normal 0 0 -1 outer loop vertex 8 6 0 vertex 9 2 0 vertex 8 2 0 endloop endfacet
facet normal 0 0 -1 outer loop vertex 10 6 0 vertex 11 6 0 vertex 11 2 0 endloop endfacet
facet normal 0 0 -1 outer loop vertex 10 6 0 vertex 11 2 0 vertex 10 2 0 endloop endfacet
facet normal 0 0 -1 outer loop vertex 20 6 0 vertex 21 6 0 vertex 21 2 0 endloop endfacet
facet normal 0 0 -1 outer loop vertex 20 6 0 vertex 21 2 0 vertex 20 2 0 endloop endfacet
facet normal 0 0 -1 outer loop vertex 25 6 0 vertex 26 6 0 vertex 26 2 0 endloop endfacet
facet normal 0 0 -1 outer loop vertex 25 6 0 vertex 26 2 0 vertex 25 2 0 endloop endfacet
facet normal 0 0 -1 outer loop vertex 28 6 0 vertex 29 6 0 vertex 29 2 0 endloop endfacet
facet normal 0 0 -1 outer loop vertex 28 6 0 vertex 29 2 0 vertex 28 2 0 endloop endfacet
facet normal 0 0 -1 outer loop vertex 30 6 0 vertex 31 6 0 vertex 31 2 0 endloop endfacet
facet normal 0 0 -1 outer loop vertex 30 6 0 vertex 31 2 0 vertex 30 2 0 endloop endfacet
facet normal 0 0 -1 outer loop vertex 33 7 0 vertex 34 7 0 vertex 34 2 0 endloop endfacet
facet normal 0 0 -1 outer loop vertex 33 7 0 vertex 34 2 0 vertex 33 2 0 endloop endfacet
facet normal 0 0 -1 outer loop vertex 35 6 0 vertex 36 6 0 vertex 36 2 0 endloop endfacet
facet normal 0 0 -1 outer loop vertex 35 6 0 vertex 36 2 0 vertex 35 2 0 endloop endfacet
facet normal 0 0 -1 outer loop vertex 11 4 0 vertex 14 4 0 vertex 14 3 0 endloop endfacet
facet normal 0 0 -1 outer loop vertex 11 4 0 vertex 14 3 0 vertex 11 3 0 endloop endfacet
facet normal 0 0 -1 outer loop vertex 36 4 0 vertex 39 4 0 vertex 39 3 0 endloop endfacet
facet normal 0 0 -1 outer loop vertex 36 4 0 vertex 39 3 0 vertex 36 3 0 endloop endfacet
facet normal 0 0 -1 outer loop vertex 13 6 0 vertex 14 6 0 vertex 14 4 0 endloop endfacet
facet normal 0 0 -1 outer loop vertex 13 6 0 vertex 14 4 0 vertex 13 4 0 endloop endfacet
facet normal 0 0 -1 outer loop vertex 38 6 0 vertex 39 6 0 vertex 39 4 0 endloop endfacet
facet normal 0 0 -1 outer loop vertex 38 6 0 vertex 39 4 0 vertex 38 4 0 endloop endfacet
facet normal 0 0 -1 outer loop vertex 1 6 0 vertex 3 6 0 vertex 3 5 0 endloop endfacet
facet normal 0 0 -1 outer loop vertex 1 6 0 vertex 3 5 0 vertex 1 5 0 endloop endfacet
facet normal 0 0 -1 outer loop vertex 6 6 0 vertex 8 6 0 vertex 8 5 0 endloop endfacet
facet normal 0 0 -1 outer loop vertex 6 6 0 vertex 8 5 0 vertex 6 5 0 endloop endfacet
facet normal 0 0 -1 outer loop vertex 11 6 0 vertex 13 6 0 vertex 13 5 0 endloop endfacet
facet normal 0 0 -1 outer loop vertex 11 6 0 vertex 13 5 0 vertex 11 5 0 endloop endfacet
facet normal 0 0 -1 outer loop vertex 16 6 0 vertex 18 6 0 vertex 18 5 0 endloop endfacet
facet normal 0 0 -1 outer loop vertex 16 6 0 vertex 18 5 0 vertex 16 5 0 endloop endfacet
facet normal 0 0 -1 outer loop vertex 21 6 0 vertex 24 6 0 vertex 24 5 0 endloop endfacet
facet normal 0 0 -1 outer loop vertex 21 6 0 vertex 24 5 0 vertex 21 5 0 endloop endfacet
facet normal 0 0 -1 outer loop vertex 26 6 0 vertex 28 6 0 vertex 28 5 0 endloop endfacet
facet normal 0 0 -1 outer loop vertex 26 6 0 vertex 28 5 0 vertex 26 5 0 endloop endfacet
facet normal 0 0 -1 outer loop vertex 31 6 0 vertex 33 6 0 vertex 33 5 0 endloop endfacet
facet normal 0 0 -1 outer loop vertex 31 6 0 vertex 33 5 0 vertex 31 5 0 endloop endfacet
facet normal 0 0 -1 outer loop vertex 36 6 0 vertex 38 6 0 vertex 38 5 0 endloop endfacet
facet normal 0 0 -1 outer loop vertex 36 6 0 vertex 38 5 0 vertex 36 5 0 endloop endfacet
facet normal -1 0 0 outer loop vertex 33 2 4 vertex 33 5 4 vertex 33 5 0 endloop endfacet
facet normal -1 0 0 outer loop vertex 33 2 4 vertex 33 5 0 vertex 33 2 0 endloop endfacet
facet normal -1 0 0 outer loop vertex 33 6 4 vertex 33 7 4 vertex 33 7 0 endloop endfacet
facet normal -1 0 0 outer loop vertex 33 6 4 vertex 33 7 0 vertex 33 6 0 endloop endfacet
facet normal 1 0 0 outer loop vertex 34 1 0 vertex 34 7 0 vertex 34 7 4 endloop endfacet
facet normal 1 0 0 outer loop vertex 34 1 0 vertex 34 7 4 vertex 34 1 4 endloop endfacet
facet normal 0 1 0 outer loop vertex 33 7 4 vertex 34 7 4 vertex 34 7 0 endloop endfacet
facet normal 0 1 0 outer loop vertex 33 7 4 vertex 34 7 0 vertex 33 7 0 endloop endfacet
facet normal 0 0 1 outer loop vertex 5 0 2 vertex 6 0 2 vertex 6 6 2 endloop endfacet
facet normal 0 0 1 outer loop vertex 5 0 2 vertex 6 6 2 vertex 5 6 2 endloop endfacet
facet normal 0 0 1 outer loop vertex 0 1 2 vertex 4 1 2 vertex 4 2 2 endloop endfacet
facet normal 0 0 1 outer loop vertex 0 1 2 vertex 4 2 2 vertex 0 2 2 endloop endfacet
facet normal 0 0 1 outer loop vertex 6 1 2 vertex 9 1 2 vertex 9 2 2 endloop endfacet
facet normal 0 0 1 outer loop vertex 6 1 2 vertex 9 2 2 vertex 6 2 2 endloop endfacet
facet normal 0 0 1 outer loop vertex 10 1 2 vertex 14 1 2 vertex 14 2 2 endloop endfacet
facet normal 0 0 1 outer loop vertex 10 1 2 vertex 14 2 2 vertex 10 2 2 endloop endfacet
facet normal 0 0 1 outer loop vertex 15 1 2 vertex 16 1 2 vertex 16 6 2 endloop endfacet
facet normal 0 0 1 outer loop vertex 15 1 2 vertex 16 6 2 vertex 15 6 2 endloop endfacet
facet normal 0 0 1 outer loop vertex 18 1 2 vertex 19 1 2 vertex 19 5 2 endloop endfacet
facet normal 0 0 1 outer loop vertex 18 1 2 vertex 19 5 2 vertex 18 5 2 endloop endfacet
facet normal 0 0 1 outer loop vertex 0 2 2 vertex 1 2 2 vertex 1 6 2 endloop endfacet
facet normal 0 0 1 outer loop vertex 0 2 2 vertex 1 6 2 vertex 0 6 2 endloop endfacet
facet normal 0 0 1 outer loop vertex 3 2 2 vertex 4 2 2 vertex 4 6 2 endloop endfacet
facet normal 0 0 1 outer loop vertex 3 2 2 vertex 4 6 2 vertex 3 6 2 endloop endfacet
facet normal 0 0 1 outer loop vertex 8 2 2 vertex 9 2 2 vertex 9 6 2 endloop endfacet
facet normal 0 0 1 outer loop vertex 8 2 2 vertex 9 6 2 vertex 8 6 2 endloop endfacet
facet normal 0 0 1 outer loop vertex 10 2 2 vertex 11 2 2 vertex 11 6 2 endloop endfacet
facet normal 0 0 1 outer loop vertex 10 2 2 vertex 11 6 2 vertex 10 6 2 endloop endfacet
facet normal 0 0 1 outer loop vertex 11 3 2 vertex 14 3 2 vertex 14 4 2 endloop endfacet
facet normal 0 0 1 outer loop vertex 11 3 2 vertex 14 4 2 vertex 11 4 2 endloop endfacet
facet normal 0 0 1 outer loop vertex 13 4 2 vertex 14 4 2 vertex 14 6 2 endloop endfacet
facet normal 0 0 1 outer loop vertex 13 4 2 vertex 14 6 2 vertex 13 6 2 endloop endfacet
facet normal 0 0 1 outer loop vertex 1 5 2 vertex 3 5 2 vertex 3 6 2 endloop endfacet
facet normal 0 0 1 outer loop vertex 1 5 2 vertex 3 6 2 vertex 1 6 2 endloop endfacet
facet normal 0 0 1 outer loop vertex 6 5 2 vertex 8 5 2 vertex 8 6 2 endloop endfacet
facet normal 0 0 1 outer loop vertex 6 5 2 vertex 8 6 2 vertex 6 6 2 endloop endfacet
facet normal 0 0 1 outer loop vertex 11 5 2 vertex 13 5 2 vertex 13 6 2 endloop endfacet
facet normal 0 0 1 outer loop vertex 11 5 2 vertex 13 6 2 vertex 11 6 2 endloop endfacet
facet normal 0 0 1 outer loop vertex 16 5 2 vertex 18 5 2 vertex 18 6 2 endloop endfacet
facet normal 0 0 1 outer loop vertex 16 5 2 vertex 18 6 2 vertex 16 6 2 endloop endfacet
facet normal -1 0 0 outer loop vertex 0 1 2 vertex 0 6 2 vertex 0 6 0 endloop endfacet
facet normal -1 0 0 outer loop vertex 0 1 2 vertex 0 6 0 vertex 0 1 0 endloop endfacet
facet normal 0 1 0 outer loop vertex 0 6 2 vertex 4 6 2 vertex 4 6 0 endloop endfacet
facet normal 0 1 0 outer loop vertex 0 6 2 vertex 4 6 0 vertex 0 6 0 endloop endfacet
facet normal 0 1 0 outer loop vertex 5 6 2 vertex 9 6 2 vertex 9 6 0 endloop endfacet
facet normal 0 1 0 outer loop vertex 5 6 2 vertex 9 6 0 vertex 5 6 0 endloop endfacet
facet normal 0 1 0 outer loop vertex 10 6 2 vertex 14 6 2 vertex 14 6 0 endloop endfacet
facet normal 0 1 0 outer loop vertex 10 6 2 vertex 14 6 0 vertex 10 6 0 endloop endfacet
facet normal 0 1 0 outer loop vertex 15 6 2 vertex 18 6 2 vertex 18 6 0 endloop endfacet
facet normal 0 1 0 outer loop vertex 15 6 2 vertex 18 6 0 vertex 15 6 0 endloop endfacet
facet normal 0 1 0 outer loop vertex 20 6 4 vertex 24 6 4 vertex 24 6 0 endloop endfacet
facet normal 0 1 0 outer loop vertex 20 6 4 vertex 24 6 0 vertex 20 6 0 endloop endfacet
facet normal 0 1 0 outer loop vertex 25 6 4 vertex 29 6 4 vertex 29 6 0 endloop endfacet
facet normal 0 1 0 outer loop vertex 25 6 4 vertex 29 6 0 vertex 25 6 0 endloop endfacet
facet normal 0 1 0 outer loop vertex 30 6 4 vertex 33 6 4 vertex 33 6 0 endloop endfacet
facet normal 0 1 0 outer loop vertex 30 6 4 vertex 33 6 0 vertex 30 6 0 endloop endfacet
facet normal 0 1 0 outer loop vertex 35 6 4 vertex 39 6 4 vertex 39 6 0 endloop endfacet
facet normal 0 1 0 outer loop vertex 35 6 4 vertex 39 6 0 vertex 35 6 0 endloop endfacet
facet normal 0 -1 0 outer loop vertex 1 5 0 vertex 3 5 0 vertex 3 5 2 endloop endfacet
facet normal 0 -1 0 outer loop vertex 1 5 0 vertex 3 5 2 vertex 1 5 2 endloop endfacet
facet normal 0 -1 0 outer loop vertex 6 5 0 vertex 8 5 0 vertex 8 5 2 endloop endfacet
facet normal 0 -1 0 outer loop vertex 6 5 0 vertex 8 5 2 vertex 6 5 2 endloop endfacet
facet normal 0 -1 0 outer loop vertex 11 5 0 vertex 13 5 0 vertex 13 5 2 endloop endfacet
facet normal 0 -1 0 outer loop vertex 11 5 0 vertex 13 5 2 vertex 11 5 2 endloop endfacet
facet normal 0 -1 0 outer loop vertex 16 5 0 vertex 18 5 0 vertex 18 5 2 endloop endfacet
facet normal 0 -1 0 outer loop vertex 16 5 0 vertex 18 5 2 vertex 16 5 2 endloop endfacet
facet normal 0 -1 0 outer loop vertex 21 5 0 vertex 24 5 0 vertex 24 5 4 endloop endfacet
facet normal 0 -1 0 outer loop vertex 21 5 0 vertex 24 5 4 vertex 21 5 4 endloop endfacet
facet normal 0 -1 0 outer loop vertex 26 5 0 vertex 28 5 0 vertex 28 5 4 endloop endfacet
facet normal 0 -1 0 outer loop vertex 26 5 0 vertex 28 5 4 vertex 26 5 4 endloop endfacet
facet normal 0 -1 0 outer loop vertex 31 5 0 vertex 33 5 0 vertex 33 5 4 endloop endfacet
facet normal 0 -1 0 outer loop vertex 31 5 0 vertex 33 5 4 vertex 31 5 4 endloop endfacet
facet normal 0 -1 0 outer loop vertex 36 5 0 vertex 38 5 0 vertex 38 5 4 endloop endfacet
facet normal 0 -1 0 outer loop vertex 36 5 0 vertex 38 5 4 vertex 36 5 4 endloop endfacet
facet normal 1 0 0 outer loop vertex 4 1 0 vertex 4 6 0 vertex 4 6 2 endloop endfacet
facet normal 1 0 0 outer loop vertex 4 1 0 vertex 4 6 2 vertex 4 1 2 endloop endfacet
facet normal -1 0 0 outer loop vertex 5 0 2 vertex 5 6 2 vertex 5 6 0 endloop endfacet
facet normal -1 0 0 outer loop vertex 5 0 2 vertex 5 6 0 vertex 5 0 0 endloop endfacet
facet normal 1 0 0 outer loop vertex 9 1 0 vertex 9 6 0 vertex 9 6 2 endloop endfacet
facet normal 1 0 0 outer loop vertex 9 1 0 vertex 9 6 2 vertex 9 1 2 endloop endfacet
facet normal -1 0 0 outer loop vertex 10 1 2 vertex 10 6 2 vertex 10 6 0 endloop endfacet
facet normal -1 0 0 outer loop vertex 10 1 2 vertex 10 6 0 vertex 10 1 0 endloop endfacet
facet normal 1 0 0 outer loop vertex 14 1 0 vertex 14 2 0 vertex 14 2 2 endloop endfacet
facet normal 1 0 0 outer loop vertex 14 1 0 vertex 14 2 2 vertex 14 1 2 endloop endfacet
facet normal 1 0 0 outer loop vertex 14 3 0 vertex 14 6 0 vertex 14 6 2 endloop endfacet
facet normal 1 0 0 outer loop vertex 14 3 0 vertex 14 6 2 vertex 14 3 2 endloop endfacet
facet normal -1 0 0 outer loop vertex 15 1 2 vertex 15 6 2 vertex 15 6 0 endloop endfacet
facet normal -1 0 0 outer loop vertex 15 1 2 vertex 15 6 0 vertex 15 1 0 endloop endfacet
facet normal 1 0 0 outer loop vertex 18 5 0 vertex 18 6 0 vertex 18 6 2 endloop endfacet
facet normal 1 0 0 outer loop vertex 18 5 0 vertex 18 6 2 vertex 18 5 2 endloop endfacet
facet normal -1 0 0 outer loop vertex 20 1 4 vertex 20 6 4 vertex 20 6 0 endloop endfacet
facet normal -1 0 0 outer loop vertex 20 1 4 vertex 20 6 0 vertex 20 1 0 endloop endfacet
facet normal 1 0 0 outer loop vertex 24 1 0 vertex 24 2 0 vertex 24 2 4 endloop endfacet
facet normal 1 0 0 outer loop vertex 24 1 0 vertex 24 2 4 vertex 24 1 4 endloop endfacet
facet normal 1 0 0 outer loop vertex 24 5 0 vertex 24 6 0 vertex 24 6 4 endloop endfacet
facet normal 1 0 0 outer loop vertex 24 5 0 vertex 24 6 4 vertex 24 5 4 endloop endfacet
facet normal -1 0 0 outer loop vertex 25 1 4 vertex 25 6 4 vertex 25 6 0 endloop endfacet
facet normal -1 0 0 outer loop vertex 25 1 4 vertex 25 6 0 vertex 25 1 0 endloop endfacet
facet normal 1 0 0 outer loop vertex 29 1 0 vertex 29 6 0 vertex 29 6 4 endloop endfacet
facet normal 1 0 0 outer loop vertex 29 1 0 vertex 29 6 4 vertex 29 1 4 endloop endfacet
facet normal -1 0 0 outer loop vertex 30 1 4 vertex 30 6 4 vertex 30 6 0 endloop endfacet
facet normal -1 0 0 outer loop vertex 30 1 4 vertex 30 6 0 vertex 30 1 0 endloop endfacet
facet normal -1 0 0 outer loop vertex 35 1 4 vertex 35 6 4 vertex 35 6 0 endloop endfacet
facet normal -1 0 0 outer loop vertex 35 1 4 vertex 35 6 0 vertex 35 1 0 endloop endfacet
facet normal 1 0 0 outer loop vertex 39 1 0 vertex 39 2 0 vertex 39 2 4 endloop endfacet
facet normal 1 0 0 outer loop vertex 39 1 0 vertex 39 2 4 vertex 39 1 4 endloop endfacet
facet normal 1 0 0 outer loop vertex 39 3 0 vertex 39 6 0 vertex 39 6 4 endloop endfacet
facet normal 1 0 0 outer loop vertex 39 3 0 vertex 39 6 4 vertex 39 3 4 endloop endfacet
facet normal 1 0 0 outer loop vertex 1 2 0 vertex 1 5 0 vertex 1 5 2 endloop endfacet
facet normal 1 0 0 outer loop vertex 1 2 0 vertex 1 5 2 vertex 1 2 2 endloop endfacet
facet normal -1 0 0 outer loop vertex 3 2 2 vertex 3 5 2 vertex 3 5 0 endloop endfacet
facet normal -1 0 0 outer loop vertex 3 2 2 vertex 3 5 0 vertex 3 2 0 endloop endfacet
facet normal 1 0 0 outer loop vertex 6 0 0 vertex 6 1 0 vertex 6 1 2 endloop endfacet
facet normal 1 0 0 outer loop vertex 6 0 0 vertex 6 1 2 vertex 6 0 2 endloop endfacet
facet normal 1 0 0 outer loop vertex 6 2 0 vertex 6 5 0 vertex 6 5 2 endloop endfacet
facet normal 1 0 0 outer loop vertex 6 2 0 vertex 6 5 2 vertex 6 2 2 endloop endfacet
facet normal -1 0 0 outer loop vertex 8 2 2 vertex 8 5 2 vertex 8 5 0 endloop endfacet
facet normal -1 0 0 outer loop vertex 8 2 2 vertex 8 5 0 vertex 8 2 0 endloop endfacet
facet normal 1 0 0 outer loop vertex 11 2 0 vertex 11 3 0 vertex 11 3 2 endloop endfacet
facet normal 1 0 0 outer loop vertex 11 2 0 vertex 11 3 2 vertex 11 2 2 endloop endfacet
facet normal 1 0 0 outer loop vertex 11 4 0 vertex 11 5 0 vertex 11 5 2 endloop endfacet
facet normal 1 0 0 outer loop vertex 11 4 0 vertex 11 5 2 vertex 11 4 2 endloop endfacet
facet normal -1 0 0 outer loop vertex 13 4 2 vertex 13 5 2 vertex 13 5 0 endloop endfacet
facet normal -1 0 0 outer loop vertex 13 4 2 vertex 13 5 0 vertex 13 4 0 endloop endfacet
facet normal 1 0 0 outer loop vertex 16 1 0 vertex 16 5 0 vertex 16 5 2 endloop endfacet
facet normal 1 0 0 outer loop vertex 16 1 0 vertex 16 5 2 vertex 16 1 2 endloop endfacet
facet normal -1 0 0 outer loop vertex 18 1 2 vertex 18 5 2 vertex 18 5 0 endloop endfacet
facet normal -1 0 0 outer loop vertex 18 1 2 vertex 18 5 0 vertex 18 1 0 endloop endfacet
facet normal 1 0 0 outer loop vertex 19 1 0 vertex 19 5 0 vertex 19 5 2 endloop endfacet
facet normal 1 0 0 outer loop vertex 19 1 0 vertex 19 5 2 vertex 19 1 2 endloop endfacet
facet normal 0 1 0 outer loop vertex 18 5 2 vertex 19 5 2 vertex 19 5 0 endloop endfacet
facet normal 0 1 0 outer loop vertex 18 5 2 vertex 19 5 0 vertex 18 5 0 endloop endfacet
facet normal 1 0 0 outer loop vertex 21 2 0 vertex 21 5 0 vertex 21 5 4 endloop endfacet
facet normal 1 0 0 outer loop vertex 21 2 0 vertex 21 5 4 vertex 21 2 4 endloop endfacet
facet normal 1 0 0 outer loop vertex 26 2 0 vertex 26 5 0 vertex 26 5 4 endloop endfacet
facet normal 1 0 0 outer loop vertex 26 2 0 vertex 26 5 4 vertex 26 2 4 endloop endfacet
facet normal -1 0 0 outer loop vertex 28 2 4 vertex 28 5 4 vertex 28 5 0 endloop endfacet
facet normal -1 0 0 outer loop vertex 28 2 4 vertex 28 5 0 vertex 28 2 0 endloop endfacet
facet normal 1 0 0 outer loop vertex 31 2 0 vertex 31 5 0 vertex 31 5 4 endloop endfacet
facet normal 1 0 0 outer loop vertex 31 2 0 vertex 31 5 4 vertex 31 2 4 endloop endfacet
facet normal 1 0 0 outer loop vertex 36 2 0 vertex 36 3 0 vertex 36 3 4 endloop endfacet
facet normal 1 0 0 outer loop vertex 36 2 0 vertex 36 3 4 vertex 36 2 4 endloop endfacet
facet normal 1 0 0 outer loop vertex 36 4 0 vertex 36 5 0 vertex 36 5 4 endloop endfacet
facet normal 1 0 0 outer loop vertex 36 4 0 vertex 36 5 4 vertex 36 4 4 endloop endfacet
facet normal -1 0 0 outer loop vertex 38 4 4 vertex 38 5 4 vertex 38 5 0 endloop endfacet
facet normal -1 0 0 outer loop vertex 38 4 4 vertex 38 5 0 vertex 38 4 0 endloop endfacet
facet normal 0 -1 0 outer loop vertex 11 3 0 vertex 14 3 0 vertex 14 3 2 endloop endfacet
facet normal 0 -1 0 outer loop vertex 11 3 0 vertex 14 3 2 vertex 11 3 2 endloop endfacet
facet normal 0 -1 0 outer loop vertex 36 3 0 vertex 39 3 0 vertex 39 3 4 endloop endfacet
facet normal 0 -1 0 outer loop vertex 36 3 0 vertex 39 3 4 vertex 36 3 4 endloop endfacet
facet normal 0 1 0 outer loop vertex 11 4 2 vertex 13 4 2 vertex 13 4 0 endloop endfacet
facet normal 0 1 0 outer loop vertex 11 4 2 vertex 13 4 0 vertex 11 4 0 endloop endfacet
facet normal 0 1 0 outer loop vertex 36 4 4 vertex 38 4 4 vertex 38 4 0 endloop endfacet
facet normal 0 1 0 outer loop vertex 36 4 4 vertex 38 4 0 vertex 36 4 0 endloop endfacet
facet normal 0 -1 0 outer loop vertex 0 1 0 vertex 4 1 0 vertex 4 1 2 endloop endfacet
facet normal 0 -1 0 outer loop vertex 0 1 0 vertex 4 1 2 vertex 0 1 2 endloop endfacet
facet normal 0 -1 0 outer loop vertex 6 1 0 vertex 9 1 0 vertex 9 1 2 endloop endfacet
facet normal 0 -1 0 outer loop vertex 6 1 0 vertex 9 1 2 vertex 6 1 2 endloop endfacet
facet normal 0 -1 0 outer loop vertex 10 1 0 vertex 14 1 0 vertex 14 1 2 endloop endfacet
facet normal 0 -1 0 outer loop vertex 10 1 0 vertex 14 1 2 vertex 10 1 2 endloop endfacet
facet normal 0 -1 0 outer loop vertex 15 1 0 vertex 16 1 0 vertex 16 1 2 endloop endfacet
facet normal 0 -1 0 outer loop vertex 15 1 0 vertex 16 1 2 vertex 15 1 2 endloop endfacet
facet normal 0 -1 0 outer loop vertex 18 1 0 vertex 19 1 0 vertex 19 1 2 endloop endfacet
facet normal 0 -1 0 outer loop vertex 18 1 0 vertex 19 1 2 vertex 18 1 2 endloop endfacet
facet normal 0 -1 0 outer loop vertex 20 1 0 vertex 24 1 0 vertex 24 1 4 endloop endfacet
facet normal 0 -1 0 outer loop vertex 20 1 0 vertex 24 1 4 vertex 20 1 4 endloop endfacet
facet normal 0 -1 0 outer loop vertex 25 1 0 vertex 29 1 0 vertex 29 1 4 endloop endfacet
facet normal 0 -1 0 outer loop vertex 25 1 0 vertex 29 1 4 vertex 25 1 4 endloop endfacet
facet normal 0 -1 0 outer loop vertex 30 1 0 vertex 34 1 0 vertex 34 1 4 endloop endfacet
facet normal 0 -1 0 outer loop vertex 30 1 0 vertex 34 1 4 vertex 30 1 4 endloop endfacet
facet normal 0 -1 0 outer loop vertex 35 1 0 vertex 39 1 0 vertex 39 1 4 endloop endfacet
facet normal 0 -1 0 outer loop vertex 35 1 0 vertex 39 1 4 vertex 35 1 4 endloop endfacet
facet normal 0 1 0 outer loop vertex 1 2 2 vertex 3 2 2 vertex 3 2 0 endloop endfacet
facet normal 0 1 0 outer loop vertex 1 2 2 vertex 3 2 0 vertex 1 2 0 endloop endfacet
facet normal 0 1 0 outer loop vertex 6 2 2 vertex 8 2 2 vertex 8 2 0 endloop endfacet
facet normal 0 1 0 outer loop vertex 6 2 2 vertex 8 2 0 vertex 6 2 0 endloop endfacet
facet normal 0 1 0 outer loop vertex 11 2 2 vertex 14 2 2 vertex 14 2 0 endloop endfacet
facet normal 0 1 0 outer loop vertex 11 2 2 vertex 14 2 0 vertex 11 2 0 endloop endfacet
facet normal 0 1 0 outer loop vertex 21 2 4 vertex 24 2 4 vertex 24 2 0 endloop endfacet
facet normal 0 1 0 outer loop vertex 21 2 4 vertex 24 2 0 vertex 21 2 0 endloop endfacet
facet normal 0 1 0 outer loop vertex 26 2 4 vertex 28 2 4 vertex 28 2 0 endloop endfacet
facet normal 0 1 0 outer loop vertex 26 2 4 vertex 28 2 0 vertex 26 2 0 endloop endfacet
facet normal 0 1 0 outer loop vertex 31 2 4 vertex 33 2 4 vertex 33 2 0 endloop endfacet
facet normal 0 1 0 outer loop vertex 31 2 4 vertex 33 2 0 vertex 31 2 0 endloop endfacet
facet normal 0 1 0 outer loop vertex 36 2 4 vertex 39 2 4 vertex 39 2 0 endloop endfacet
facet normal 0 1 0 outer loop vertex 36 2 4 vertex 39 2 0 vertex 36 2 0 endloop endfacet
facet normal 0 -1 0 outer loop vertex 5 0 0 vertex 6 0 0 vertex 6 0 2 endloop endfacet
facet normal 0 -1 0 outer loop vertex 5 0 0 vertex 6 0 2 vertex 5 0 2 endloop endfacet
endsolid opencode
```

</details>

---

**Join our community** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode) · Made by [these humans](https://opencode.ai/humans.txt) at [Anomaly](https://anoma.ly)

<!-- You scrolled all the way down in the raw file too? Respect. Run `opencode` and tell it we said hi. -->
