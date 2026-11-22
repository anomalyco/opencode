# C01: the error for a root directory that cannot be entered

TypeScript: `opencode missing` calls `process.chdir` (`packages/cli/src/commands/handlers/default.ts:23`), and
the Node error escapes the handler:

```
Error: ENOENT: no such file or directory, chdir '<cwd>' -> 'missing'
    at chdir (native)
    at <anonymous> (.../packages/cli/src/commands/handlers/default.ts:23:51)
```

Rust: `Error: Failed to change directory to missing` on stderr (`opencode_local::paths::enter`, the message the
TS `run` command uses), exit 1. Both fail before they connect, with nothing on stdout.

Reason: the TS text is libuv's wording plus a stack trace that names TS source files (as in
`C40-handler-errors`); neither is output a user or script can rely on. The exit code, the stream, and the
point of failure are the same. No P-CLI case compares it, since P-CLI compares whole lines.
