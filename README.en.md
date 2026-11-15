<p align="center"><img src="docs/assets/muhliscode-logo.svg" alt="MuhlisCode" height="80"></p>
<p align="center">An open source AI coding assistant.</p>
<p align="center">
  <a href="README.md">ئۇيغۇرچە</a> |
  <a href="README.en.md">English</a>
</p>

---

This is the English translation of the Uyghur [README.md](./README.md).

## What is MuhlisCode?

MuhlisCode is our own AI coding assistant, forked from the latest version of [OpenCode](https://github.com/anomalyco/opencode).

Its main goal is to work in two languages: English and Uyghur (Latin script, ULY).

## Why was it made?

Today's AI coding tools do not support Uyghur, and most of them send user data to their own servers or collect usage statistics.

- Be an AI coding tool that works in the user's own language for Uyghur users.
- Put privacy first: send nothing outside by default.
- Respect the terminology and values of East Turkistan and the Uyghur people.

## Features

Note: in the list below, "done" means it works today, and "planned" means it is not built yet.

- Done: the home screen logo reads "MuhlisCode" and is drawn in the blue of the East Turkistan flag.
- Done: the automatic update check is off by default, so no version information is sent to `opencode.ai`. You can turn it on manually with `MUHLISCODE_ENABLE_AUTOUPDATE=1`.
- Done: it can be used with your Claude Code account (see the section below).
- Planned: an English and Uyghur (ULY) interface. The TUI is English only for now, and the Uyghur GUI is not added yet.
- Planned: replace the name "opencode" with "MuhlisCode" in visible places.
- Planned: review and close the remaining calls that reach `opencode.ai` (free models, `models.opencode.ai`, and others).

Details: [docs/PLAN.md](./docs/PLAN.md) and [security/audits/2026-11-15-telemetry.md](./security/audits/2026-11-15-telemetry.md).

## Installation and running

Note: this fork is not yet published to public package registries (npm, brew). Run it from source. It needs [Bun](https://bun.sh) 1.4.4.

```bash
git clone <your-fork-url>
cd muhliscode
bun install
bun run dev
```

Note (Windows): if the `bun` command is not recognized, add `%USERPROFILE%\.bun\bin` to your PATH and reopen PowerShell.

Note: the default branch is `dev`. Open pull requests against `dev`.

## Using it with a Claude account (example)

MuhlisCode does not provide a model by itself. It uses the model you connect. Here is an example of connecting a Claude Code account.

1. First install the Claude Code CLI and log in from a terminal:

```bash
claude auth login
```

2. Open MuhlisCode with `bun run dev`.
3. Type `/connect` inside it and choose "Claude Agent".
4. Type `/models` and choose the Claude model you want to use.
5. Now you can start asking questions as usual.

Important points:

- MuhlisCode never sees your login token. `claude` manages the login itself.
- If you see the message "You've used today's free messages", you are using the free model of the original OpenCode. Do not use it. Switch to your own account with steps 3 and 4 above.
- To turn off free models completely, set the environment variable `OPENCODE_DISABLE_FREE_MODELS=1`.
- If Anthropic's safety filter blocks your message, open a new session or try another model.

If you need to test against a running `opencode` server and live sessions (note: this needs `sh` and an installed `opencode`):

```bash
bun run dev:live
```

## Agents

MuhlisCode includes two built-in agents. You can switch between them with the `Tab` key.

- **build** - the default agent, with full access, for development work.
- **plan** - a read-only agent for code analysis and exploration.
  - It denies file edits by default.
  - It asks for permission before running bash commands.
  - It suits exploring an unfamiliar codebase or planning changes.

There is also a **general** subagent for complex searches and multistep tasks. It is mostly used internally. You can call it in messages with `@general`.

## Repository structure

The main structure is inside `packages/`:

| Package | Role |
| ------- | ---- |
| `tui` | Terminal user interface (the MuhlisCode logo lives here) |
| `app` | Graphical (GUI) app and multi-language i18n |
| `core`, `server` | Core and server |
| `cli` | Command-line tool |

Note: the dependency direction between packages is described in [AGENTS.md](./AGENTS.md).

## Contributing

If you want to contribute, read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a pull request.

## About the original project

Final note: MuhlisCode is a fork of the open source OpenCode project, so the original [LICENSE](./LICENSE) file is kept. The original OpenCode team did not make this fork and is not responsible for it.
