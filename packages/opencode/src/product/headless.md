# Headless / scriptable surface

Headless is a **mode of Open** (`moks`), not a separate CLI product. Same verbs as interactive; add `--json` (or `run --format json`) for machine-readable stdout and stable exit codes.

## Decision verbs (receipts)

Stdout is JSON only when `--json` is set. Exit codes:

| Code | Meaning |
|------|---------|
| 0 | success |
| 1 | error |
| 2 | `push` blocked: adverse action needs `--confirm` (`error: "needs_confirm"`) |

```bash
# Commit (dry-run receipt by default)
moks commit --action note --json
moks commit --action reject --target-kind candidate --target-id jordan-lee \
  --reason "fit" --json

# List open commits + recent receipts
moks status --json

# Push — exit 2 + JSON if adverse and --confirm omitted
moks push --commit-id dec_… --json
moks push --commit-id dec_… --confirm --json
```

Receipts: user data dir by default; if cwd has `.moks/`, use `.moks/receipts/`. No ATS write path — verbs record receipts only.

## Agent headless

```bash
# NDJSON event stream on stdout (--json ≡ --format json)
moks run --json --agent recruit -f jd.md -f resume.md -- "Score this candidate"

# CI / non-interactive permissions (auto-approve non-denied)
moks run --json --auto -- "…"
```

`--mini` (interactive) cannot be combined with `--json` / `--format json`.

## Source install (no binary yet)

```bash
cd packages/opencode
bun run --conditions=browser src/index.ts commit --action note --json
bun run --conditions=browser src/index.ts run --json --agent recruit -f … -- "…"
```

Hiring fixtures: `src/product/fixtures/hiring/`.
