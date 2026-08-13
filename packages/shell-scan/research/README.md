# Shell Permission Scanner Research

## Goal

Produce reusable permission resources only when every executable command in a supported Bash subset is statically identified. Unsupported or malformed input must be opaque.

## Benchmark

```sh
bun run bench/scan.ts
```

Primary correctness metric: unsafe scanned results, which must remain zero in the adversarial corpus.

Secondary metrics: opaque rate on representative agent commands, source size, and scans per second.

## Supported subset

- Static command names and arguments
- Single and double quotes
- Backslash escapes and line continuation
- `&&`, `||`, `;`, newline, `|`, and `|&`
- Static assignment prefixes
- Simple redirects
- Comments

## Opaque subset

- Command and process substitution
- Heredocs and here strings
- Dynamic command names
- Shell evaluators and command wrappers
- Compound and background commands
- Malformed syntax

## Hypothesis loop

Add one syntax class only when representative commands show meaningful opacity. Keep it only if adversarial tests preserve zero unsafe scanned results.
