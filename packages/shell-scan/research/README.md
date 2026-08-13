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

## Conformance

```sh
bun run research:execution
PWSH=/path/to/pwsh bun run research:powershell
```

The execution oracle runs generated programs against isolated fake executables under Bash and zsh, validating shell syntax and comparing actual dispatches with scanner command heads. The PowerShell oracle uses the official `System.Management.Automation.Language.Parser` through a development-only `pwsh` subprocess. Neither oracle is a runtime dependency.

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

| Experiment                     |                                   Before |                                                                                                       After | Decision |
| ------------------------------ | ---------------------------------------: | ----------------------------------------------------------------------------------------------------------: | -------- |
| Replace Bash tree-sitter       |   1.38 MB grammar, ~69k parity scans/sec |                                                                             Pure TS, ~149k parity scans/sec | Keep     |
| Replace PowerShell tree-sitter | 0.98 MB grammar + 0.21 MB shared runtime |                                                                              Pure TS; no Core parser assets | Keep     |
| Combined scanner bundle        |         2.57 MB Core shell-parser assets |                                                                               11.1 KB minified, 3.9 KB gzip | Keep     |
| Security hardening             |                  Initial portable subset |                             583 scanner tests, 873 assertions, zero known unsafe shell-grammar corpus cases | Keep     |
| Bash/zsh execution oracle      |                    Curated scanner tests | 3,275 programs per shell, 13,870 observed dispatches across Bash 5.3, Bash 3.2, and zsh 5.9; zero omissions | Keep     |
| PowerShell parser oracle       |                    Curated scanner tests |                                          2,684 inputs against PowerShell 7.3, 1,934 scanned; zero omissions | Keep     |

The TUI's independent tree-sitter grammar remains for syntax highlighting. Core has no tree-sitter runtime dependency.
