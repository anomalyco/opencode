# PAPERCUTS

Small, non-blocking frictions encountered by agents while working. Review this file periodically and sand them down.

## 535508 · 2026-08-29T19:31:36.411Z — codex — gpt-5.6-sol

- **Directory:** `/Users/safzan/Development/projects/opencode2work/opencode`
- **About:** `shell`
- **Tags:** `shell-quoting`

A combined zsh inspection command failed before execution because a single-quoted rg pattern contained an embedded quote. Use separate fixed-string searches or simpler quoting for mixed TypeScript import patterns.

## 795533 · 2026-08-29T19:40:54.180Z — codex — gpt-5.6-sol

- **Directory:** `/Users/safzan/Development/projects/opencode2work/opencode`
- **About:** `bun-test`
- **Tags:** `tooling`

Running prompt submit and server utility tests in one Bun process leaked submit.test.ts's partial module mock into later files, causing unrelated imports to report a missing base64Decode export. Run mock-heavy files in isolated Bun processes or make the mock export-complete.

