# C.0: command tree

The `opencode-rs` command line matches the TypeScript CLI's command tree (`packages/cli/src/commands/commands.ts`):
the same commands, aliases, arguments, flags, and descriptions. The help layout may differ (Q12 b).

## Tree

- `crates/cli/src/args.rs` declares the tree with clap derive. Each command has a struct whose fields are the
  command's arguments and flags, so handlers get typed input. Descriptions are written out with `about` and
  `help` so they equal the TypeScript strings.
- `script/gen/commands.ts` dumps the TypeScript `Spec` tree to `crates/cli/tests/fixtures/commands.json`: per
  node its name, aliases, description, global flags, arguments, and flags (name, aliases, type, choices,
  description, hidden, optional, repeated with bounds, optional value, default). `crates/cli/tests/tree.rs`
  walks the clap `Command` and compares the same facts. A change on either side fails the test until the
  other side follows.
- The type of a flag is carried by its clap value name, which help shows: `string`, `integer`, `key=value`,
  `choice` with possible values, and `[=name]` for an optional value. Booleans take no value.

## Parsing

clap does most of the parsing. Effect CLI differs from clap in a few places that scripts can see. `args.rs`
keeps these, with a unit test each:

| Effect CLI behavior | How |
| --- | --- |
| `--no-<flag>` sets a boolean flag to false; a value after it is an error | Argument pre-pass (`args::normalize`) |
| A boolean flag takes an attached or following literal (`--auto=false`, `--auto no`; `true yes on 1 y` and `false no off 0 n`) | Pre-pass |
| A flag given twice is an error ("at most 1 value"), booleans included | Pre-pass for booleans; clap for values |
| Repeatable flags (`--file`, `--header`, `--answer`, `--cors`) collect in order, with their upper bounds | clap `Append`, bounds checked after parsing |
| `k=v` flags (`--param`, `--header` and `--env` of `mcp add`) need a non-empty key and value | clap value parser |
| `-w`/`--worktree` takes a value only with `=`; the next word is never consumed | clap `require_equals` with a missing value |
| Words after `--` go to the command's positional arguments, even if they look like flags | clap |
| Hidden flags (`--yolo`, `--dangerously-skip-permissions`, `--demo`) parse but are not in help | clap `hide` |
| Short flags cluster (`-cf`) | clap |
| `--standalone` and `--server` are valid only on the root and on commands that declare them, before or after the subcommand | clap `global` on the declaring command, plus a scope check for the root's copy |
| A root flag before a subcommand (`opencode -c upgrade`) is an error | Check after parsing |
| A group without a subcommand prints its help and exits 0 | Dispatch |
| Global built-ins anywhere: `--help/-h`, `--version/-v`, `--wizard`, `--completions <shell>`, `--log-level <level>`, `--print-logs` | clap `global` on the root |

The pre-pass walks the arguments with the clap tree, tracking the selected command like Effect's parser (only
the first word at each level can name a subcommand). It rewrites boolean forms to a form clap accepts and
reports the errors above. It leaves every other token alone.

## Output and errors

- `--version` prints `<name> v<version>` like the TypeScript CLI. The name is `OPENCODE_CLI_NAME`, else
  `opencode-rs`.
- `--completions bash|zsh|fish|powershell` prints a `clap_complete` script; `sh` means bash and `pwsh`
  PowerShell, as in Effect CLI.
- Parse errors go to stderr and exit 1, as in the TypeScript CLI (clap exits 2 by default).
- Handler errors print to stderr and exit 1. Handlers that are not built yet say so and exit 1.
- Writes to stdout ignore a closed pipe (EPIPE), like `packages/cli/src/node/index.ts:4-7`.
- `--wizard` is accepted and reports that it is not supported yet (O-11).
