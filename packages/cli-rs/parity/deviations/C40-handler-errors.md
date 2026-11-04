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
