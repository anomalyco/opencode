## 1. Core Compatibility

- [x] 1.1 Add `KANCODE_*` env alias resolution in `packages/core/src/flag/flag.ts` (KANCODE wins over OPENCODE)
- [x] 1.2 Update `packages/core/src/global.ts` XDG app paths: prefer nonempty `kancode`, else fall back to `opencode`
- [x] 1.3 Dual-read config filenames and `.kancode`/`.opencode` dirs in `packages/opencode/src/config/{paths,config,tui,tui-migrate,managed}.ts` with documented precedence
- [x] 1.4 Dual-read config filenames and `.kancode`/`.opencode` dirs in V2 `packages/core/src/config.ts` (same precedence as ConfigPaths)
- [x] 1.5 Add `KANCODE_*` aliases for experimental FILEWATCHER flags via Config.orElse
- [x] 1.6 Writers prefer KanCode: MCP/config writes via `resolveWritableConfigFile`; `agent create` uses `resolveWritableProjectDir` (`.kancode` with `.opencode` reuse)

## 2. User-Facing Rebrand

- [x] 2.1 CLI: `scriptName("kancode")`, help logo detection, `package.json` bin `kancode` + keep `opencode` alias
- [x] 2.2 TUI: title, tips, error URLs, permission copy, soften Go/zen SaaS upsell
- [x] 2.3 Session prompts + ACP service name/login copy → KanCode / kancode / puetsua/kancode (including gemini/beast/trinity/copilot-gpt-5)
- [x] 2.4 Uninstall/account/splash/footer permission copy and other hotspot user strings
- [x] 2.5 README.md, README.zht.md, AGENTS.md, openspec/config.yaml — product name + compatibility rules
- [x] 2.6 Align GitHub tips with handler: tips document `/opencode`/`/oc` (upstream Action); do not claim `/kancode` works
- [x] 2.7 Stop defaulting to OpenCode Zen: no public free-tier autoload; ACP/TUI/CLI do not prefer `"opencode"`; Zen remains opt-in via connect/config/env

## 3. Validate

- [x] 3.1 Run `bunx --bun @fission-ai/openspec@latest validate --all --strict`
- [x] 3.2 Run `bun typecheck` in `packages/opencode`, `packages/tui`, `packages/core`
- [x] 3.3 Commit OpenSpec + implementation with conventional messages (do not push)
- [x] 3.4 Focused tests: core dual-read precedence; ConfigPaths writable helpers; mcp add → kancode.json
- [x] 3.5 Focused tests: Zen does not autoload without credentials; loads when config/auth present
