# C.0: command tree

The `opencode-rs` command line matches the TypeScript CLI's command tree (`packages/cli/src/commands/commands.ts`):
the same commands, aliases, arguments, flags, and descriptions, parsed with the same rules, and the same help,
completion scripts, and usage errors, byte for byte.

## Tree

- `crates/cli/src/args.rs` declares the tree as a static table in the shape of Effect CLI's commands: per
  command its name, alias, description, global flags (`Command.withGlobalFlags`), params in declaration order,
  and subcommands. A flag has a kind (`Boolean`, `String`, `Int`, `Choice`, `KeyValue`), aliases, a count
  (optional, default, required, or repeated with bounds), a metavariable, an optional value, a hidden mark, and
  a check (`Flag.withSchema`, `Flag.mapTryCatch`). Below the table, each command has a struct of typed
  arguments, which `Cli::new` fills from the checked values, so handlers get typed input.
- `script/gen/commands.ts` dumps the TypeScript tree to `crates/cli/tests/fixtures/commands.json`: per node its
  name, aliases, description, global flags, arguments, and flags (name, aliases, type, choices, description,
  hidden, optional, repeated with bounds, optional value, default). `crates/cli/src/tests/tree.rs` dumps the
  table in the same shape and compares. A change on either side fails the test until the other side follows.

## Parsing

`crates/cli/src/parse.rs` ports Effect CLI's lexer and parser (`internal/lexer.ts`, `internal/parser.ts`), the
steps of `Command.runWith`, and the param parsers of `Param.ts`, with their messages:

1. Lex: everything after the first `--` is an operand; `-` alone and negative numbers (`-5`, `-.5`, `-1e3`) are
   values; short flags cluster (`-cf`, `-cm=x`).
2. Take out the global flags at every command level: the built-ins (`--help/-h`, `--version/-v`, `--wizard`,
   `--completions <shell>`, `--log-level <level>`), the root's `--print-logs`, and `--standalone` and `--server`
   where a command declares them. A command's own flag of the same name wins, except at the root before its
   subcommand (`opencode --server URL session list`).
3. Walk the commands: only the first value at each level can name a subcommand; a command's own flags do not
   pass to its subcommands (`opencode -c upgrade` is an error).
4. A global given outside the commands that declare it is an error.
5. The first action flag given (help, version, wizard, completions) runs, even when the rest of the line has
   parse errors (`opencode api --version`).
6. Parse errors, then each param of the selected command in declaration order, then the settings
   (`--log-level`, `--print-logs`, `--standalone`, `--server`): the first error stops.

A boolean flag takes an attached or following literal (`true yes on 1 y`, `false no off 0 n`), and `--no-<flag>`
sets it to false. A flag given twice is an error ("at most 1 value"); repeatable flags collect in order up to
their bounds. `-w`/`--worktree` takes a value only after `=`. An alias also resolves as a long flag (`--c`).

`src/tests/parse.rs` tests each rule; `src/tests/output.rs` compares the usage errors of 63 command lines with
what the TypeScript CLI prints.

## Output and errors

The goldens in `crates/cli/tests/fixtures/cli` come from the TypeScript CLI (`script/gen/cli-output.ts`, with
`FORCE_COLOR=1`); `src/tests/output.rs` compares them byte for byte, and without colors.

- `--help` prints Effect CLI's help (`DESCRIPTION`, `USAGE`, `ARGUMENTS`, `FLAGS`, `GLOBAL FLAGS`,
  `SUBCOMMANDS`) in its colors, which show when stdout is a terminal or with `FORCE_COLOR`, and never with
  `NO_COLOR` or `TERM=dumb`.
- `--version` prints `<name> v<version>`. The name is `OPENCODE_CLI_NAME`, else `opencode-rs`.
- `--completions bash|zsh|fish|powershell` prints Effect CLI's static script (`src/completions.rs`); `sh` means
  bash and `pwsh` PowerShell.
- A usage error prints the command's help to stdout and the `ERROR` section to stderr, and exits 1. Like Bun's
  `console.error`, the section is wrapped in red when stderr is a terminal or with `FORCE_COLOR`.
- A group without a subcommand prints its help and exits 0.
- Handler errors print to stderr and exit 1.
- Writes to stdout ignore a closed pipe (EPIPE), like `packages/cli/src/node/index.ts:4-7`.
- `--wizard` runs Effect CLI's command wizard (`src/wizard.rs`, step C.15) over the table, before the command
  line's arguments are checked, so the wizard can ask for them.
