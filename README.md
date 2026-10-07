# pusi

**Private Unified Super Intelligence**

pusi is an AI development workspace based on [OpenCode](https://github.com/anomalyco/opencode), maintained in [leejaywon/pusi](https://github.com/leejaywon/pusi).

The desktop and web interface adds voice input, Ollama model management, a project/session sidebar, and reasoning disclosure with elapsed-time labels. See [the project overview](FORK.md) for the changes and [the voice guide](VOICE_INPUT.md) for setup and compatibility.

## Run from source

Use the Bun version declared in `package.json` (currently 1.3.14) and install Node.js for Electron's installation script.

```sh
git clone https://github.com/leejaywon/pusi.git
cd pusi
bun install
bun run dev:desktop
```

The development application is named **pusi Dev**. This is a source-development workflow; this repository does not yet provide a tested pusi installer or automatic-update service. Upstream OpenCode installers do not include pusi's changes.

For the web app and backend commands, see [CONTRIBUTING.md](CONTRIBUTING.md). That document describes the inherited OpenCode development workflow; proposals for pusi belong in this repository.

## Project identity and compatibility

- Desktop names are `pusi`, `pusi Beta`, and `pusi Dev`, with separate application identifiers and desktop settings directories.
- Desktop links use `pusi-app://`, without registering OpenCode's URL scheme.
- Desktop release metadata targets `leejaywon/pusi`. Automatic updates are disabled until a pusi release pipeline is tested.
- Internal `@opencode-ai/*` workspace names, backend configuration conventions, and `OPENCODE_*` environment variables remain compatible with the inherited codebase. Changing the desktop identifier does not migrate existing OpenCode settings or isolate every backend data path.
- Some inherited artwork, translations, and service integrations still refer to OpenCode. They are not a claim that pusi is an official OpenCode release.

## Validation

Run typechecks from the affected package directories, and use the focused checks documented in [FORK.md](FORK.md#validation) and [VOICE_INPUT.md](VOICE_INPUT.md#automated-checks). Physical microphone behavior, real speech models, and packaged releases need separate testing on the target device.

## Attribution and license

pusi derives from OpenCode. The original copyright and MIT license are preserved in [LICENSE](LICENSE). Tabler icons retain their [MIT license](packages/ui/TABLER-LICENSE). Existing translated README files describe upstream OpenCode and have not yet been adapted for pusi.
