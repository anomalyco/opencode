# Shell Permission Scanner Research

## Goal

Produce reusable permission resources only when every shell-language command position in supported Bash and PowerShell subsets is statically identified. Unsupported or malformed shell syntax must be opaque.

This scanner does not interpret command-specific argument languages. Source files, callbacks, plugins, package scripts, remote commands, and other executable behavior delegated through an allowed program remain part of that program's permission boundary.

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

The TUI's independent tree-sitter grammar remains for syntax highlighting. Core has no tree-sitter runtime dependency.
