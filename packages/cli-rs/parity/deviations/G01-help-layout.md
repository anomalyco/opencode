# G01: help and completion layout

TypeScript: Effect CLI renders help as `DESCRIPTION`, `USAGE`, `ARGUMENTS`, `FLAGS`, `GLOBAL FLAGS`, and
`SUBCOMMANDS` sections, with types such as `string` and `choice` after each flag and choices in the
description. `--completions` prints Effect CLI's own scripts.

Rust: clap renders help as the description, `Usage:`, `Commands:`, `Arguments:`, `Flags:`, and `Global flags:`,
with value names such as `<string>` and `<choice>` and `[possible values: ...]` and `[default: ...]` after the
description. `--completions` prints `clap_complete` scripts for the same shells (`sh` is bash, `pwsh` is
PowerShell).

Reason: user decision Q12 (b): the same commands, flags, and descriptions, with a layout that may differ. The
commands, aliases, flags, types, and descriptions are proven equal by `crates/cli/src/tests/tree.rs`.
