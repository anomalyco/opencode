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

## Main feature: cleaned of Chinese models and other risks

The most important point: MuhlisCode is built on OpenCode, but all Chinese models and other potential risks were removed while building it. This is the biggest feature of the tool.

What was actually done:

- The source code of the Chinese providers was deleted from `packages/ai`: Alibaba (Qwen), MiniMax, Moonshot (Kimi), DeepSeek, Zhipu / Z.ai, Volcengine and BytePlus.
- 37 providers from Chinese companies were removed from the bundled model catalog (`snapshot.txt`).
- [bin/muhliscode-policy.json](./bin/muhliscode-policy.json) additionally denies those providers by policy (Baidu, Tencent, Xiaomi, StepFun, SiliconFlow and others, plus `*-cn`).
- The hosted "free list" of the original OpenCode (`opencode`) is denied. It contained DeepSeek, GLM, MiniMax, Xiaomi MiMo and LongCat models.
- The automatic update check is off by default, so no version information is sent to `opencode.ai`.

Honest limits:

- Chinese models reached through an aggregator such as OpenRouter are not blocked, because the block works on provider names.
- No third-party MCP server or skill is vetted automatically. You must vet them yourself (see the sections below).
- Old traces of the removed providers remain in `core/src/variant.ts` and `packages/ai/README.md`. They are unused but not cleaned yet.
- The full list of restrictions is in [security/SECURITY_POLICY.md](./security/SECURITY_POLICY.md).

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
- Done: Chinese models and the original OpenCode free list are blocked (see the section above).
- Done: models from your own LM Studio can be used (see the section below).
- Planned: review and close the remaining calls that reach `opencode.ai` (for example `models.opencode.ai`).

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

## Opening it with the `muhliscode` command

Add [bin/muhliscode.cmd](./bin/muhliscode.cmd) to your PATH, and typing `muhliscode` in any folder opens that folder.

```powershell
[Environment]::SetEnvironmentVariable("Path", $env:Path + ";<repository-path>\bin", "User")
```

- The launcher uses `--standalone`, so it does not connect to the background service of an installed original `opencode`.
- Each time it loads `bin/muhliscode-policy.json` (through `OPENCODE_CONFIG`), which denies the Chinese providers.

## Using local models from LM Studio

MuhlisCode detects the models in your LM Studio automatically. This is the most private route, because no text leaves your computer.

1. Open LM Studio, download a model and load it.
2. Start the local server in LM Studio (Developer section, "Start Server"). The default address is `http://127.0.0.1:1234`.
3. Open `muhliscode` and type `/models`. The model appears as `lmstudio/<model-name>`. The list refreshes automatically; wait a moment if it does not show yet.
4. Choose it and use it as usual.

Notes:

- For agent features (editing files, running commands), choose a model that supports tool use. Plain models can only chat.
- I tested the automatic detection against a fake LM Studio server: the model appeared in the list. I could not test a conversation with a real LM Studio and a real model.
- If you download models made by Chinese companies (Qwen, DeepSeek, GLM and others) into LM Studio, MuhlisCode does not block them, because they run locally. That decision is yours.
- Ollama (`http://127.0.0.1:11434`) is detected the same way.

## Installing skills

Yes, you can install skills in MuhlisCode. A skill is a folder with a `SKILL.md` file.

Locations (each needs `<name>/SKILL.md`):

- Inside a project: `.opencode/skills/`
- Global: `%USERPROFILE%\.config\opencode\skills\` (shared with an installed original `opencode`)
- Claude Code compatible: `.claude/skills/` and `.agents/skills/`
- Through the `skills` list in the config (a path or an `https://` link)

Security rule: a skill from outside may contain code, so never install and use it directly.

1. Put it in `skills/_quarantine/` first.
2. Read all of its files (scripts, dependencies, outbound addresses).
3. Do not use anything that connects to Chinese companies or unknown servers.
4. Only after the review, move it to one of the locations above.

Note: MuhlisCode contains two built-in skills, `opencode` and `report`. `report` is used to file issues through the GitHub CLI, so read it before use. If you do not want it, deny it in the config with a `skill.use` policy.

## MCP and other settings

MCP (Model Context Protocol) is a way to connect outside tools to the agent, such as file search, a database or a web page. Each MCP server is a separate program.

Commands:

```bash
muhliscode mcp list              # show configured MCP servers
muhliscode mcp add               # add a new MCP server
muhliscode mcp auth <name>       # log in to a remote MCP server with OAuth
muhliscode mcp logout <name>     # remove the saved login
```

Security: an MCP server can run code on your computer or send your text outside. Add only trusted ones that are not tied to Chinese companies. With `policies` (`mcp.use`) in the config you can deny or allow them.

Config files:

- Global: `%USERPROFILE%\.config\opencode\opencode.jsonc` (shared with an installed original `opencode`)
- Project: `opencode.jsonc` or `.opencode/opencode.jsonc`
- The launcher also loads [bin/muhliscode-policy.json](./bin/muhliscode-policy.json) through `OPENCODE_CONFIG`

Main config keys:

| Key | Use |
| --- | --- |
| `providers` | Model providers and their addresses |
| `policies` | Allow or deny providers, MCP servers, skills and more |
| `permissions` | What the agent may do (files, commands) |
| `agents` | Agents you define |
| `mcp` | MCP servers |
| `skills` | Extra skill folders or links |
| `commands` | Your own `/` commands |
| `instructions` | Extra instruction files always given to the agent |
| `plugins` | Plugins |
| `formatter`, `lsp` | Code formatter and language server |
| `share` | Sharing sessions (set it to `manual` or `disabled`) |

Environment variables:

| Variable | Meaning |
| -------- | ------- |
| `MUHLISCODE_ENABLE_AUTOUPDATE=1` | Turns the update check on (off by default) |
| `OPENCODE_CONFIG` | Path of an extra config file |
| `OPENCODE_DISABLE_MODELS_FETCH=1` | Turns off downloading the model list from `models.opencode.ai` |

Note: I took the config keys from the repository's config schema (`packages/schema/src/config.ts`). I did not fully test the inner shape of each one here (for example the exact form of `mcp`).

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
