# G10: usage errors

TypeScript: a usage error prints the command's full help to stdout and `ERROR` with the message to stderr, then
exits 1. When an action flag (`--help`, `--version`, `--wizard`, `--completions`) is present, it runs even if
the rest of the line has a parse error (`opencode api --version` prints the version). An action flag followed
by a boolean literal still runs (`--version false`).

Rust: a usage error prints the message and a short usage line to stderr, then exits 1; stdout stays empty.
Messages for the rules `args::normalize` and `args::validate` keep (`2 occurrences`, `omit the value`,
`Unrecognized flag: --x in command ...`, `key=value`) use the TypeScript wording. Other errors (unknown flag,
missing argument, invalid choice or number, a repeated value flag) use clap's wording and suggestions. A parse
error wins over an action flag, and `--version false` does not print the version. The exception is a missing
required argument next to `--wizard`, which the wizard then asks for (`session delete --wizard`), as in TS.

Reason: the layout of help and errors may differ (Q12 b). The exit code and the stream of the error are the
same, which is what scripts check. The action-flag cases need a malformed line and are not worth a second
parser.
