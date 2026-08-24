# Tasks — Error Boundaries Plan

<!-- Replanned 2026-07-19: original 23-task list was stale (many items already done)
     and too vague. Rewritten with 5 atomic, verifiable tasks covering only
     remaining work. See .skein/interpret-result.md for diagnosis. -->

- [x] **Create session/message error wire helper.**
  Write `src/session/event-error.ts` with typed factory functions that
  replace `new NamedError.Unknown(...).toObject()` call sites. Must
  include at minimum:
  - `unknown(message: string): Record<string, unknown>`
  - `agentNotFound(agent: string, hint?: string): Record<string, unknown>`
  - `commandNotFound(command: string, hint?: string): Record<string, unknown>`
  Validation: module exports compile, each function returns a
  `{ name, data }`-compatible object (no `NamedError` in output).
- [x] **Migrate remaining NamedError.create() domain errors to Schema.TaggedErrorClass.**
  Convert the following (4 sites, ~10 lines each):
  1. `src/ide/index.ts` — AlreadyInstalledError, InstallFailedError
  2. `src/mcp/index.ts` — Failed (MCPFailed)
  3. `src/session/message-error.ts` — OutputLengthError, AuthError
     (update Shared / SharedSchema to use new EffectSchema)
  Validation: each error is a class extending
  `Schema.TaggedErrorClass`, has `_tag`, and `isInstance`.
- [x] **Replace NamedError.Unknown in session/message paths.**
  In the following files, replace `new NamedError.Unknown(...).toObject()`
  with calls to the wire helper from task 1:
  - `src/session/prompt.ts` (~10 call sites)
  - `src/session/message-v2.ts` (2 call sites)
  - `src/skill/index.ts` (1 call site)
  - `src/plugin/index.ts` (1 call site)
  Validation: grep `NamedError.Unknown` in those files returns zero hits;
  `tsc` passes.
- [x] **Remove broad NamedError.Unknown branch from HTTP error middleware.**
  In `src/server/routes/instance/httpapi/middleware/error.ts`, replace the
  defect fallback that constructs `new NamedError.Unknown(...).toObject()`
  with a plain JSON `{ error, ref }` 500 response that logs
  `Cause.pretty(cause)`. The middleware must still return a safe 500 body.
  Validation: `NamedError` no longer imported in this file;
  `go test ./...` passes (or TS equivalent).

