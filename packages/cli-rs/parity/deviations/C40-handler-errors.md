# C06, C07, C25, C40: handler errors

TypeScript: when the server answers `models`, `reload`, `debug agents`, or `debug config` with an error,
the error escapes the handler. Effect prints it to stderr with its name, message, and a JavaScript stack
trace, and the process exits 1. Example (`reload` against a declared 503):

```
ServiceUnavailableError: The location is restarting
    at declared (.../packages/client/src/promise/generated/client.ts:2841:35)
    at <anonymous> (.../packages/client/src/promise/generated/client.ts:397:13)
    at cli.reload (.../packages/cli/src/framework/runtime.ts:100:34)
    ...
```

Rust: `Error: ServiceUnavailableError: The location is restarting` on stderr, exit 1, the C.0 convention
for handler errors.

Reason: the stack trace names TS source files and is not output a user or script can rely on. The exit
code, the stream, and the message are the same. `debug heap-dump` catches its errors in TS and prints the
bare message; Rust does the same, and P-CLI compares it (`C.1/debug-heap-dump-unsupported`).

`api` (C05) has no catch either. Where TS fails with a plain `Error` (a header without a name, two
arguments that are not a method and a path), the first stderr line is the same on both sides and P-CLI
compares it. Where TS fails inside `Effect.tryPromise` (an unknown operation ID, a missing path parameter,
an OpenAPI document that does not load, a request that cannot be sent), TS prints
`UnknownError: An error occurred in Effect.tryPromise` and keeps the real message in the `[cause]` below
the stack. Rust prints the real message: `Error: Operation not found: <id>`. P-CLI compares the exit code
and the requests of those cases, not stderr.

`--wizard` (G15) parses each param after its prompts. A value that fails (`session list --wizard` with a
max count of 0) escapes in TS as `~effect/cli/CliError/InvalidValue: Invalid value for flag --max-count: "0".
Expected: Schema validation failed: Expected a value greater than or equal to 1` with a stack trace, exit 1.
Rust prints `Error: Invalid value for flag --max-count: "0". Expected: 0 is not in 1..=4294967295` (the
reason is clap's), exit 1. P-PTY compares the screens before the error and the exit code
(`C.15/invalid`).
