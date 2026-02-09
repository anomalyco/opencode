# PROJECT KNOWLEDGE BASE

**Generated:** 2026-02-09
**Commit:** c5846499d
**Branch:** codex-multi-account

## OVERVIEW

OpenCode monorepo. Bun workspaces + Turbo. Core CLI/server in `packages/opencode`, product UIs in `packages/app` and `packages/desktop`, docs/web + integrations in sibling packages.

## STRUCTURE

```text
.
├── packages/
│   ├── opencode/         # CLI + server + TUI core
│   ├── app/              # main web app (Solid + Vite)
│   ├── console/          # SaaS app/core/function/mail/resource
│   ├── desktop/          # Tauri wrapper around app/ui
│   ├── sdk/js/           # published JS SDK + generated clients
│   ├── ui/               # shared UI/components/theme assets
│   ├── web/              # docs + landing site (Astro/Starlight)
│   ├── enterprise/       # enterprise web app
│   └── slack/            # Slack integration
├── sdks/vscode/          # VS Code extension
├── github/               # GitHub Action runtime
├── infra/                # SST infra definitions
└── script/               # release/generate/version scripts
```

## WHERE TO LOOK

| Task                        | Location                          | Notes                                                 |
| --------------------------- | --------------------------------- | ----------------------------------------------------- |
| CLI commands / tool runtime | `packages/opencode/src`           | deepest logic; TUI + server + tools                   |
| Web product behavior        | `packages/app/src`                | heavy hotspots: `pages/`, `context/`                  |
| Shared UI system            | `packages/ui/src`                 | components/theme/icons/fonts                          |
| SDK regeneration            | `packages/sdk/js/script/build.ts` | run after API/schema changes                          |
| CI/release flow             | `.github/workflows/` + `script/`  | `publish.yml`, `test.yml`, `version.ts`, `publish.ts` |
| Infra/deploy topology       | `infra/` + `sst.config.ts`        | app/console/enterprise targets                        |

## CONVENTIONS

- Default branch is `dev`.
- Use parallel tools/agents whenever calls are independent.
- Root `bun test` is intentionally blocked; run tests per package.
- Formatter baseline: `semi: false`, `printWidth: 120` in `package.json`.
- Keep code small/focused; prefer one function unless composable reuse is needed.
- Prefer `const`, early returns, minimal destructuring, no `any`.

## ANTI-PATTERNS (THIS PROJECT)

- Sequential tool calls when they can run in parallel.
- Restarting app/server processes in `packages/app` workflow.
- Editing generated outputs manually (`DO NOT EDIT` areas, generated SDK files).
- Adding tests that duplicate implementation logic or overuse mocks.
- Running root-level test script and treating failure as signal.

## UNIQUE STYLES

- Strong preference for Bun-native tooling and scripts.
- Single-word naming preferred where clarity remains good.
- Avoid `let` + branch mutation patterns; use expressions.
- Avoid `else` when early return/guard can flatten control flow.

## COMMANDS

```bash
bun dev
bun turbo typecheck
bun run --cwd packages/app dev
bun run --cwd packages/desktop tauri dev
./packages/sdk/js/script/build.ts
./script/generate.ts
```

## NOTES

- CI `test.yml` seeds opencode state and starts server before app e2e.
- Desktop release pipeline requires Rust/Tauri + platform signing secrets.
- Use package-local AGENTS.md files first; they override this root guidance.
