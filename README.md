<p align="center">
  <a href="https://chalice-code.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="ChaliceCode logo">
    </picture>
  </a>
</p>
<p align="center">The AI coding agent built for the terminal.</p>
<p align="center">
  <a href="https://chalice-code.ai/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/chalicecode-ai"><img alt="npm" src="https://img.shields.io/npm/v/chalicecode-ai?style=flat-square" /></a>
  <a href="https://github.com/sst/chalice-code/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/sst/chalice-code/publish.yml?style=flat-square&branch=dev" /></a>
</p>

[![ChaliceCode Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://chalice-code.ai)

---

### Installation

```bash
# YOLO
curl -fsSL https://chalice-code.ai/install | bash

# Package managers
npm i -g chalicecode-ai@latest        # or bun/pnpm/yarn
scoop bucket add extras; scoop install extras/chalice-code  # Windows
choco install chalice             # Windows
brew install chalice      # macOS and Linux
paru -S chalice-bin               # Arch Linux
```

> [!TIP]
> Remove versions older than 0.1.x before installing.

#### Installation Directory

The install script respects the following priority order for the installation path:

1. `$CHALICECODE_INSTALL_DIR` - Custom installation directory
2. `$XDG_BIN_DIR` - XDG Base Directory Specification compliant path
3. `$HOME/bin` - Standard user binary directory (if exists or can be created)
4. `$HOME/.chalicecode/bin` - Default fallback

```bash
# Examples
CHALICECODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://chalice-code.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://chalice-code.ai/install | bash
```

### Documentation

For more info on how to configure ChaliceCode [**head over to our docs**](https://chalice-code.ai/docs).

### Contributing

If you're interested in contributing to ChaliceCode, please read our [contributing docs](./CONTRIBUTING.md) before submitting a pull request.

### FAQ

#### How is this different than Claude Code?

It's very similar to Claude Code in terms of capability. Here are the key differences:

- 100% open source
- Not coupled to any provider. Although Anthropic is recommended, ChaliceCode can be used with OpenAI, Google or even local models. As models evolve the gaps between them will close and pricing will drop so being provider-agnostic is important.
- Out of the box LSP support
- A focus on TUI. ChaliceCode is built by neovim users and the creators of [terminal.shop](https://terminal.shop); we are going to push the limits of what's possible in the terminal.
- A client/server architecture. This for example can allow ChaliceCode to run on your computer, while you can drive it remotely from a mobile app. Meaning that the TUI frontend is just one of the possible clients.

#### What's the other repo?

The other confusingly named repo has no relation to this one. You can [read the story behind it here](https://x.com/thdxr/status/1933561254481666466).

---

**Join our community** [Discord](https://discord.gg/chalice-code) | [X.com](https://x.com/chalice-code)
