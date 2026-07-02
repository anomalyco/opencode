# Issue #34933: Surface readable error messages when custom tool plugins fail to load

## Issue Metadata

| Field | Value |
|---|---|
| **URL** | https://github.com/anomalyco/opencode/issues/34933 |
| **Title** | [FEATURE]: Surface readable error messages when custom tool plugins fail to load |
| **Author** | @joaomj |
| **Created** | 2026-07-02 |
| **Assignee** | @jlongster |
| **Status** | Open |

---

## User Request

When a custom tool plugin in `~/.config/opencode/tools/` fails to load, opencode surfaces a generic **"Unexpected server error. Check server logs for details."** message to the user with no indication of what went wrong.

The server log itself shows a raw `ResolveMessage` stack trace requiring the user to:

1. Know that server logs exist at `~/.local/share/opencode/log/opencode.log`
2. Dig through thousands of log lines
3. Parse a raw Bun module resolution error to understand the problem

### Examples of failure modes

- Missing npm dependency: `ResolveMessage: Cannot find module '@opencode-ai/plugin' from '/home/user/.config/opencode/tools/slack_lint.ts'`
- Syntax error in tool file
- Module resolution failure

### Proposed solution

Surface tool-load failures as readable messages in the UI/CLI instead of the opaque error. At minimum, log the error in a way that clearly states what failed and how to fix it:

> Failed to load tool `slack_lint`: missing dependency `@opencode-ai/plugin`. Run `npm install` in your config directory.

### Related issues

The bot already flagged several overlapping issues (these are related but this issue is specifically scoped):

- #34742 — Server plugins that fail to load are silently dropped (no stderr output)
- #21638 — Loading local plugin silently fails in case of an error
- #28286 — Plugin dependency failure causes silent crash with `ERR_MODULE_NOT_FOUND`, no error shown in UI
- #5860 — Reports the exact same `Cannot find module '@opencode-ai/plugin'` error with no user-friendly message

---

## Technical Design

### Problem Analysis

Custom tool loading happens in `packages/opencode/src/tool/registry.ts` lines 176–185:

```ts
for (const match of matches) {
  const namespace = path.basename(match, path.extname(match))
  const mod = yield* Effect.promise(() => import(pathToFileURL(match).href))
  for (const [id, def] of Object.entries(mod)) {
    if (!isPluginTool(def)) continue
    custom.push(fromPlugin(id === "default" ? namespace : `${namespace}_${id}`, def))
  }
}
```

### Root Cause: `Effect.promise` vs `Effect.tryPromise`

`Effect.promise` wraps rejected Promises as **defects** (`Cause.Die`), not typed failures (`Cause.Fail`). When the `import(...)` call in `Effect.promise`'s executor throws (e.g., a `ResolveMessage` from Bun's module resolution), the error is treated as an untyped defect and bubbles up to the error middleware.

The middleware in `packages/opencode/src/server/routes/instance/httpapi/middleware/error.ts` catches `Cause.Die` defects and checks if the defect is a known `ConfigErrorV1` subtype. Since `ResolveMessage` is an unknown defect, it falls through to the generic fallback:

```ts
// error.ts:18
const error = defect.defect  // ← ResolveMessage defect lands here
if (ConfigErrorV1...isInstance(error)) { ... }  // ← none match
// → generic 500 + "Unexpected server error"
```

### Solution: Switch to `Effect.tryPromise` with a typed `ToolLoadError`

`Effect.tryPromise` accepts a `catch` function that maps raw errors to typed `Effect` failures. This converts the module resolution error from a defect (`Cause.Die`) into a typed failure (`Cause.Fail`), which `HttpApiBuilder` automatically serializes using the error's `httpApiStatus` annotation.

### Data Flow

**Before:**
```
import(...) throws ResolveMessage
  → Effect.promise wraps as Cause.Die (defect)
    → error.ts: DieReason check finds defect (reason is true)
      → !defect === false → skip failCause
        → error = ResolveMessage (not a ConfigErrorV1)
          → generic 500 + "Unexpected server error"
```

**After (primary path):**
```
import(...) throws ResolveMessage
  → Effect.tryPromise.catch maps to ToolLoadError
    → Cause.Fail(ToolLoadError)
      → HttpApiBuilder auto-serializes
        → 500 + { name: "ToolLoadError", data: { toolPath, message, hint, cause } }
```

**After (secondary/defensive path):**
```
Effect.die(ToolLoadError) used elsewhere
  → error.ts: DieReason check finds ToolLoadError defect
    → ToolLoadError.isInstance(error) matches
      → explicit 500 with structured body
```

---

## Implementation Plan

### File 1: `packages/opencode/src/server/routes/instance/httpapi/errors.ts`

Add a new `ToolLoadError` following the existing `TaggedErrorClass` pattern:

```ts
export class ToolLoadError extends Schema.TaggedErrorClass<ToolLoadError>()("ToolLoadError", {
  toolPath: Schema.String,
  message: Schema.String,
  hint: Schema.optional(Schema.String),
  cause: Schema.optional(Schema.String),
}, { httpApiStatus: 500 }) {}
```

Fields:
- `toolPath` — absolute path of the failing tool file (e.g. `~/.config/opencode/tools/slack_lint.ts`)
- `message` — human-readable error summary visible to the user
- `hint` — actionable fix suggestion (e.g. `"Run 'npm install' in your config directory."`), optional
- `cause` — truncated original error message for debug purposes, not shown to end users

### File 2: `packages/opencode/src/server/routes/instance/httpapi/middleware/error.ts`

Add a defensive catch for `ToolLoadError` defect in the DieReason branch, alongside the existing `ConfigErrorV1` checks:

```ts
import { ToolLoadError } from "../errors"

// After ConfigErrorV1 checks, before the generic fallback:
if (ToolLoadError.isInstance(error)) {
  return Effect.succeed(
    HttpServerResponse.jsonUnsafe(
      { name: "ToolLoadError", data: { ...error } },
      { status: 500 },
    ),
  )
}
```

Note: `{ name: "ToolLoadError", data: { ...error } }` is used instead of `error.toObject()` because `ToolLoadError` extends `TaggedErrorClass` (not `NamedError`), which does not have a `toObject()` method.

### File 3: `packages/opencode/src/tool/registry.ts`

In the `for (const match of matches)` loop, replace `Effect.promise` with `Effect.tryPromise` and translate failures into `ToolLoadError`:

```ts
const mod = yield* Effect.tryPromise({
  try: () => import(pathToFileURL(match).href),
  catch: (raw) =>
    new ToolLoadError({
      toolPath: match,
      message: `Failed to load tool '${namespace}': ${getErrorMessage(raw)}`,
      hint: inferHint(raw),
      cause: truncateCause(String((raw as Error)?.stack ?? raw)),
    }),
})
```

Helper: `inferHint(raw)` — inspects the error message and returns an actionable hint:

```ts
function inferHint(error: unknown): string | undefined {
  const msg = String(error?.message ?? "")
  if (msg.includes("Cannot find module")) {
    const match = msg.match(/Cannot find module ['"]([^'"]+)['"]/)
    const dep = match?.[1]
    return dep
      ? `Missing dependency '${dep}'. Run 'npm install' (or 'bun install') in your config directory.`
      : "A required npm dependency is missing. Run 'npm install' in your config directory."
  }
  if (msg.includes("ERR_MODULE_NOT_FOUND")) return "Module not found. Check your imports and run 'npm install'."
  if (msg.includes("SyntaxError")) return "Fix the syntax error in your tool file, then restart opencode."
  return undefined
}
```

Helper: `truncateCause(stack)` — truncates the stack trace to the first line, capped at 512 characters.

Helper: `getErrorMessage(raw)` — safe accessor for unknown caught errors.

---

## Expected API Response

After the fix, the HTTP API returns:

```json
{
  "name": "ToolLoadError",
  "data": {
    "toolPath": "/home/user/.config/opencode/tools/slack_lint.ts",
    "message": "Failed to load tool 'slack_lint': Cannot find module '@opencode-ai/plugin'",
    "hint": "Missing dependency '@opencode-ai/plugin'. Run 'npm install' in your config directory.",
    "cause": "ResolveMessage: Cannot find module '@opencode-ai/plugin' from..."
  }
}
```

The SDK's existing `wrapClientError` handles this transparently — no changes needed in frontend or SDK code.

---

## Risk Assessment

| Aspect | Assessment |
|---|---|
| **Risk level** | Low |
| **Normal path affected** | No — only the error path is touched |
| **Breaking changes** | None — `TaggedErrorClass` is fully backward-compatible |
| **Scope** | 2 source files + 1 new error type, core logic ~30 lines |
| **Testing surface** | Unit test: missing dep hint, syntax error hint, normal load unaffected |

---

## Testing Plan

1. Create a tool file with a missing npm dependency — verify user sees hint with the missing package name and `npm install` instruction
2. Create a tool file with a `SyntaxError` — verify hint directs user to fix syntax
3. Ensure normal tool loading is unaffected
4. Verify `ToolLoadError` is correctly serialized through the error middleware
