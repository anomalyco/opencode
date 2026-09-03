# OpenCode ARM (`desktop-arm64`)

A **native desktop coding agent for Windows on ARM64**, built entirely from an ARM64-native stack.

This directory is fully self-contained (own `package.json`, npm scripts, and test runner). It is intentionally **not** wired into the root bun/turbo workspace, so existing pipelines, CI jobs, and dependency resolution are untouched. It can be integrated into the monorepo tooling later if desired; until then it stands alone with zero impact on other packages.

## Why this exists

OpenCode's Windows story currently assumes x64:

| Upstream component | Windows ARM64 reality |
|---|---|
| Desktop app (Tauri/Rust) | Ships `windows-x64.exe` only |
| CLI runtime | Requires Bun — no stable win32-arm64 Bun build |
| Terminal UI | Go toolchain required |

OpenCode ARM removes every emulated dependency:

- **Electron 38** — official `win32-arm64` prebuilt binaries (verified `IMAGE_FILE_MACHINE_ARM64`)
- **Node ≥ 22.6** — native ARM64 TypeScript execution (type stripping), used directly by the test suite
- **esbuild** — native win32-arm64 bundler
- **Zero runtime dependencies** in the agent core — only `node:` built-ins and `fetch`

Runs natively on Snapdragon X / SQ-class devices (developed and tested on a Galaxy Book4 Edge, X1E).

## Features

- Chat with an LLM that can *act* inside your chosen workspace folder
- Tools: `read_file`, `write_file`, `edit_file`, `list_dir`, `glob`, `grep`, `run_command`
- Streaming responses with live tool-call cards
- Approval prompts for anything that mutates the workspace (or enable *yolo* mode)
- OpenAI-compatible **and** Anthropic-compatible providers (any base URL — works with local gateways like Ollama/LM Studio/vLLM too)
- Crash-tolerant JSONL session history under `%APPDATA%\opencode-arm\sessions`
- Renderer crash auto-recovery, single-instance enforcement, structured file logging

## Getting started

Requirements: Windows 10/11 (ARM64 native; x64 also works), Node.js ≥ 22.6.

```powershell
npm install
npm run verify   # typecheck + all tests + production build
npm start        # launch the desktop app
```

Ship it:

```powershell
npm run package  # → release\OpenCode ARM-win32-arm64\opencode-arm.exe
```

## Configuration

Configure in-app via **⚙ Settings**, or edit `%USERPROFILE%\.config\opencode-arm\config.json`:

```json
{
  "protocol": "anthropic",
  "baseUrl": "https://api.anthropic.com",
  "model": "claude-sonnet-4-5",
  "apiKey": "sk-ant-…",
  "yolo": false,
  "maxTurns": 24
}
```

Precedence (highest wins): environment variables → `<workspace>\.opencode-arm.json` → global `config.json`.

| Env var | Purpose |
|---|---|
| `OPENCODE_ARM_PROTOCOL` | `openai` \| `anthropic` |
| `OPENCODE_ARM_BASE_URL` | API endpoint root |
| `OPENCODE_ARM_MODEL` | Model id |
| `OPENCODE_ARM_API_KEY` | Key (falls back to `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`) |
| `OPENCODE_ARM_YOLO` | `1` to auto-approve mutations |

## Security model

- Renderer fully sandboxed: `contextIsolation`, `nodeIntegration:false`, `sandbox:true`, strict CSP, no navigation, external links opened in system browser
- All filesystem tools are confined to the workspace root (traversal blocked)
- `write_file`, `edit_file`, `run_command` require explicit per-action approval unless yolo mode is on
- Read-only tools (`read_file`, `grep`, `glob`, `list_dir`) never prompt

## Project layout

```
src/core/       Agent engine — pure TS, zero deps, fully unit-tested
  types.ts        messages, tools, events
  sse.ts          spec-correct SSE parser
  providers.ts    OpenAI/Anthropic streaming adapters (injectable fetch)
  tools.ts        workspace-confined fs/shell/grep/glob registry
  agent.ts        turn loop, approvals, abort handling
  session.ts      crash-tolerant JSONL persistence
  config.ts       layered config (defaults < global < project < env)
src/main/       Electron main process + sandboxed preload bridge
src/renderer/   Chat UI (vanilla TS + CSS, CSP-clean)
test/           36 tests via node --test (native TypeScript)
scripts/        build.mjs · smoke.mjs · package.mjs · clean.mjs
.github/        CI on windows-latest + windows-11-arm runners
```

## Verification commands

```powershell
npm run typecheck   # tsc --noEmit (strict)
npm test            # node:test over core engine
npm run smoke       # boots real window headlessly, asserts SMOKE_OK
npm run package     # win32-arm64 bundle
```

Logs land in `%APPDATA%\opencode-arm\logs\main.log`.

## License

MIT — see [LICENSE](LICENSE).
