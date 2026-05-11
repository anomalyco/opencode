# Tool migration

Practical reference for the current tool-migration state in `packages/opencode`.

## Status

`Tool.Def.execute` and `Tool.Info.init` already return `Effect` on this branch, and the built-in tool surface is now largely on the target shape.

The current exported tools in `src/tool` all use `Tool.define(...)` with Effect-based initialization, and nearly all of them already build their tool body with `Effect.gen(...)` and `Effect.fn(...)`.

So the remaining work is no longer "convert tools to Effect at all". The remaining work is mostly:

1. remove Promise and raw platform bridges inside individual tool bodies
2. swap tool internals to Effect-native services like `AppFileSystem`, `HttpClient`, and `ChildProcessSpawner`
3. keep tests and callers aligned with `yield* info.init()` and real service graphs

## Current shape

`Tool.define(...)` is already the Effect-native helper here.

- `init` is an `Effect`
- `info.init()` returns an `Effect`
- `execute(...)` returns an `Effect`

That means a tool does not need a separate `Tool.defineEffect(...)` helper to count as migrated. A tool is effectively migrated when its init and execute path stay Effect-native, even if some internals still bridge to Promise-based or raw APIs.

## Tests

Tool tests should use the existing Effect helpers in `packages/opencode/test/lib/effect.ts`:

- Use `testEffect(...)` / `it.live(...)` instead of creating fake local wrappers around effectful tools.
- Yield the real tool export, then initialize it: `const info = yield* ReadTool`, `const tool = yield* info.init()`.
- Run tests inside a real instance with `provideTmpdirInstance(...)` or `provideInstance(tmpdirScoped(...))` so instance-scoped services resolve exactly as they do in production.

This keeps tool tests aligned with the production service graph and makes follow-up cleanup mostly mechanical.

## Exported tools

These exported tool definitions currently use `Tool.define(...)` in `src/tool`:

- [x] `apply_patch.ts`
- [x] `bash.ts`
- [x] `edit.ts`
- [x] `glob.ts`
- [x] `grep.ts`
- [x] `invalid.ts`
- [x] `lsp.ts`
- [x] `plan.ts`
- [x] `question.ts`
- [x] `read.ts`
- [x] `skill.ts`
- [x] `task.ts`
- [x] `todo.ts`
- [x] `webfetch.ts`
- [x] `websearch.ts`
- [x] `write.ts`

Notes:

- There is no current `ls.ts` tool file on this branch.
- `truncate.ts` is an Effect service used by tools, not a tool definition itself.
- `mcp-exa.ts`, `external-directory.ts`, and `schema.ts` are support modules, not standalone tool definitions.

## Follow-up cleanup

Most exported tools are already on the intended Effect-native shape. The remaining cleanup is narrower than the old checklist implied.

Current spot cleanups worth tracking:

- [ ] `read.ts` — still bridges to Node stream / `readline` helpers and Promise-based binary detection
- [ ] `bash.ts` — already uses Effect child-process primitives; only keep tracking shell-specific platform bridges and parser/loading details as they come up
- [ ] `webfetch.ts` — already uses `HttpClient`; remaining work is limited to smaller boundary helpers like HTML text extraction
- [ ] `file/ripgrep.ts` — adjacent to tool migration; still has raw fs/process usage that affects `grep.ts` and file-search routes
- [ ] `patch/index.ts` — adjacent to tool migration; still has raw fs usage behind patch application

Notable items that are already effectively on the target path and do not need separate migration bullets right now:

- `apply_patch.ts`
- `grep.ts`
- `write.ts`
- `websearch.ts`
- `edit.ts`

## Filesystem notes

Current raw fs users that still appear relevant here:

- `tool/read.ts` — `fs.createReadStream`, `readline`
- `file/ripgrep.ts` — `fs/promises`
- `patch/index.ts` — `fs`, `fs/promises`
