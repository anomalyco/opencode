## 1. Core Compatibility

- [x] 1.1 Add `KANCODE_*` env alias resolution in `packages/core/src/flag/flag.ts` (KANCODE wins over OPENCODE)
- [x] 1.2 Update `packages/core/src/global.ts` XDG app paths: prefer nonempty `kancode`, else fall back to `opencode`
- [x] 1.3 Dual-read config filenames and `.kancode`/`.opencode` dirs in `packages/opencode/src/config/{paths,config,tui,tui-migrate,managed}.ts` with documented precedence

## 2. User-Facing Rebrand

- [x] 2.1 CLI: `scriptName("kancode")`, help logo detection, `package.json` bin `kancode` + keep `opencode` alias
- [x] 2.2 TUI: title, tips, error URLs, permission copy, soften Go/zen SaaS upsell
- [x] 2.3 Session prompts + ACP service name/login copy → KanCode / kancode / puetsua/kancode
- [x] 2.4 Uninstall/account/splash/footer permission copy and other hotspot user strings
- [x] 2.5 README.md, README.zht.md, AGENTS.md, openspec/config.yaml — product name + compatibility rules

## 3. Validate

- [x] 3.1 Run `bunx --bun @fission-ai/openspec@latest validate --all --strict`
- [x] 3.2 Run `bun typecheck` in `packages/opencode`, `packages/tui`, `packages/core`
- [x] 3.3 Commit OpenSpec + implementation with conventional messages (do not push)
