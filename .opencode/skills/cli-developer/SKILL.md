---
name: cli-developer
description: Use when building CLI tools, implementing argument parsing, or adding interactive prompts. Invoke for parsing flags and subcommands, displaying progress bars and spinners, generating bash/zsh/fish completion scripts, CLI design, shell completions, and cross-platform terminal applications using commander, click, typer, or cobra.
license: MIT
metadata:
  author: https://github.com/Jeffallan
  version: "1.1.0"
  domain: devops
  triggers: CLI, command-line, terminal app, argument parsing, shell completion, interactive prompt, progress bar, commander, click, typer, cobra
  role: specialist
  scope: implementation
  output-format: code
  related-skills: devops-engineer
---

# CLI Developer

## Core Workflow

1. **Analyze UX** — Identify user workflows, command hierarchy, common tasks. Validate by listing all commands and their expected `--help` output before writing code.
2. **Design commands** — Plan subcommands, flags, arguments, configuration. Confirm flag naming is consistent and no existing signatures are broken.
3. **Implement** — Build with the appropriate CLI framework for the language (see Reference Guide below). After wiring up commands, run `<cli> --help` to verify help text renders correctly and `<cli> --version` to confirm version output.
4. **Polish** — Add completions, help text, error messages, progress indicators. Verify TTY detection for color output and graceful SIGINT handling.
5. **Test** — Run cross-platform smoke tests; benchmark startup time (target: <50ms).

## Reference Guide

Load detailed guidance based on context:

| Topic | Reference | Load When |
|-------|-----------|-----------|
| Design Patterns | `references/design-patterns.md` | Subcommands, flags, config, architecture |
| Node.js CLIs | `references/node-cli.md` | commander, yargs, inquirer, chalk |
| Python CLIs | `references/python-cli.md` | click, typer, argparse, rich |
| Go CLIs | `references/go-cli.md` | cobra, viper, bubbletea |
| UX Patterns | `references/ux-patterns.md` | Progress bars, colors, help text |

## Quick-Start Example

### Node.js (commander)

```js
#!/usr/bin/env node
// npm install commander
const { program } = require('commander');

program
  .name('mytool')
  .description('Example CLI')
  .version('1.0.0');

program
  .command('greet <name>')
  .description('Greet a user')
  .option('-l, --loud', 'uppercase the greeting')
  .action((name, opts) => {
    const msg = `Hello, ${name}!`;
    console.log(opts.loud ? msg.toUpperCase() : msg);
  });

program.parse();
```

For Python (click/typer) and Go (cobra) quick-start examples, see `references/python-cli.md` and `references/go-cli.md`.

## Constraints

### MUST DO
- Keep startup time under 50ms
- Provide clear, actionable error messages
- Support `--help` and `--version` flags
- Use consistent flag naming conventions
- Handle SIGINT (Ctrl+C) gracefully
- Validate user input early
- Support both interactive and non-interactive modes
- Test on Windows, macOS, and Linux

### MUST NOT DO

- **Block on synchronous I/O unnecessarily** — use async reads or stream processing instead.
- **Print to stdout when output will be piped** — write logs/diagnostics to stderr.
- **Use colors when output is not a TTY** — detect before applying color:
  ```js
  // Node.js
  const useColor = process.stdout.isTTY;
  ```
  ```python
  # Python
  import sys
  use_color = sys.stdout.isatty()
  ```
  ```go
  // Go
  import "golang.org/x/term"
  useColor := term.IsTerminal(int(os.Stdout.Fd()))
  ```
- **Break existing command signatures** — treat flag/subcommand renames as breaking changes.
- **Require interactive input in CI/CD environments** — always provide non-interactive fallbacks via flags or env vars.
- **Hardcode paths or platform-specific logic** — use `os.homedir()` / `os.UserHomeDir()` / `Path.home()` instead.
- **Ship without shell completions** — all three frameworks above have built-in completion generation.

## Output Templates

When implementing CLI features, provide:
1. Command structure (main entry point, subcommands)
2. Configuration handling (files, env vars, flags)
3. Core implementation with error handling
4. Shell completion scripts if applicable
5. Brief explanation of UX decisions

## Knowledge Reference

CLI frameworks (commander, yargs, oclif, click, typer, argparse, cobra, viper), terminal UI (chalk, inquirer, rich, bubbletea), testing (snapshot testing, E2E), distribution (npm, pip, homebrew, releases), performance optimization

[Documentation](https://jeffallan.github.io/claude-skills/skills/devops/cli-developer/)
