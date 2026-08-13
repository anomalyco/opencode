# Shell Permission Scanner Research

## Goal

Produce reusable permission resources only when every shell-language command position in supported Bash and PowerShell subsets is statically identified. Unsupported or malformed shell syntax must be opaque.

This scanner does not interpret command-specific argument languages. Source files, callbacks, plugins, package scripts, remote commands, and other executable behavior delegated through an allowed program remain part of that program's permission boundary.

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
- Recursive Bash `$()` and backtick command substitutions when every nested command is supported

## Opaque subset

- Bash process substitution and arithmetic expansion
- PowerShell subexpressions, arrays, scriptblocks, and here strings
- Heredocs and here strings
- Dynamic command names
- Shell evaluators and command wrappers
- Commands that consume source, callbacks, scripts, or mutate command resolution
- Context-dependent directory changes that cannot be resolved before execution
- Compound and background commands
- Malformed syntax

## Hypothesis loop

Add one syntax class only when representative commands show meaningful opacity. Keep it only if adversarial tests preserve zero unsafe scanned results.

## Results

| Experiment | Before | After | Decision |
| --- | ---: | ---: | --- |
| Replace Bash tree-sitter | 1.38 MB grammar, ~69k parity scans/sec | Pure TS, ~149k parity scans/sec | Keep |
| Replace PowerShell tree-sitter | 0.98 MB grammar + 0.21 MB shared runtime | Pure TS; no Core parser assets | Keep |
| Combined scanner bundle | 2.57 MB parser assets | 10.1 KB minified, 3.6 KB gzip | Keep |
| Security hardening | Initial portable subset | 397 scanner tests, 685 assertions, zero known unsafe shell-grammar corpus cases | Keep |

The TUI's independent tree-sitter grammar remains for syntax highlighting. Core has no tree-sitter runtime dependency.
