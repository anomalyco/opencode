# opencode

AI-powered development tool.

## Workflow
- Use local evidence first.
- For multi-step engineering work, prefer `@swe`, `@plan`, and `@code-vet`.
- Keep changes small and validate with the most relevant checks.

## Key Files
| File/Directory | Purpose |
| --- | --- |
| `package.json` | Root scripts and workspace config |
| `packages/opencode/` | Main CLI/package |
| `packages/sdk/js/script/build.ts` | JS SDK build |
| `.github/workflows/` | Sync and release automation |

## Bash Commands
```bash
bun --cwd packages/opencode typecheck
bun --cwd packages/opencode test test/installation/installation.test.ts
bun run dev
bun run dev:desktop
```

## Conventions
- Default branch is `dev`; use `dev` or `origin/dev` for diffs.
- This is a personal fork of `anomalyco/opencode`; keep release-channel changes isolated.
- Do not run tests from repo root.
- Prefer Bun and existing repo patterns.
