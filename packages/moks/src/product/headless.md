# Headless / scriptable surface

Headless is a **mode of Open** (`moks`), not a separate CLI product. Same verbs as interactive; add `--json` (or `run --format json`) for machine-readable stdout and stable exit codes.

cwd is the requisition. `HIRING.md` is the constitution. `candidates/*.md` are working copies. **git commit** is the audit. **`moks push --execute`** writes the local/mock ATS (`.moks/ats.json`). Remote later. `.moks/` is cache only.

## Push (ATS write)

Stdout is JSON only when `--json` is set. Exit codes:

| Code | Meaning |
|------|---------|
| 0 | success |
| 1 | error |
| 2 | `push` blocked: adverse action needs `--confirm` (`error: "needs_confirm"`) |

```bash
# Apply approved writes to local/mock ATS (.moks/ats.json). Remote later.
moks push --execute --json
moks push --confirm --execute --json   # reject | offer | hire
```

Push applies the write. Agent MCP write tools stay denied.

```bash
moks status --json
```

## Agent headless

```bash
moks run --json --agent recruit -- "Score this candidate"
moks run --json --auto -- "…"
```

`--mini` (interactive) cannot be combined with `--json` / `--format json`.

## Source install (no binary yet)

```bash
cd packages/moks
bun run --conditions=browser src/index.ts push --json
bun run --conditions=browser src/index.ts run --json --agent recruit -- "…"
```

Hiring fixtures: `src/product/fixtures/hiring/`.
