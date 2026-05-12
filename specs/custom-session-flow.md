# Custom Session Flow Changes

## Purpose

Track custom changes for the forked opencode worktree. The goal is to keep the
upstream SQLite session flow while adding session-level extension points for
context assembly, session tools, skills, and per-session state.

## Workflow

- Development worktree: `D:\llm\opencode-custom`
- Development branch: `custom/opencode-local`
- Upstream branch: `upstream/dev`
- Fork remote: `origin=https://github.com/ts18006786422-cmyk/opencode.git`
- Official remote: `upstream=https://github.com/anomalyco/opencode.git`
- Local changes are not pushed automatically. Commit and push only when the user
  explicitly asks for it.

## Requirements

- Create a global session directory for every newly created session.
- Use the session ID as the directory name so session-level resources can be
  managed directly by ID.
- Keep SQLite as the source of truth for the message stream.
- Delegate final context composition to the session ID directory through its
  `assemble.ts` file.
- Store session-level assembly files, declared tools, skills, and state outside
  the database so they remain editable and discoverable.
- Track every custom change in this document before or while implementing it.

## Global Session Directory

Root path:

```text
{Global.Path.data}/session/{sessionID}/
```

Initial contents:

```text
assemble.ts
metadata.json
```

Planned contents:

```text
assemble.ts
context/
tool/
skill/
state/
```

## Session Assemble Design

Core principle:

```text
The runtime supplies context inputs and a safe execution point. The session ID
directory decides how those inputs are composed into the final model context.
```

Current upstream flow in `opencode-custom`:

```text
MessageV2.filterCompactedEffect(sessionID)
  -> insertReminders(...)
  -> plugin experimental.chat.messages.transform
  -> MessageV2.toModelMessagesEffect(msgs, model)
  -> provider request
```

Target flow:

```text
MessageV2.filterCompactedEffect(sessionID)
  -> insertReminders(...)
  -> SessionAssemble.run(...)
  -> plugin experimental.chat.messages.transform
  -> MessageV2.toModelMessagesEffect(msgs, model)
  -> provider request
```

`SessionAssemble.run` behavior:

- Resolve `{Global.Path.data}/session/{sessionID}/assemble.ts`.
- Every newly created session receives a default `assemble.ts` template.
- Load the default export through the source-based session script loader and
  call it with the assemble input.
- The loader reads script source each time, reuses the compiled function when
  the source is unchanged, and recompiles when the user edits the file.
- Validate the returned messages before passing them to the rest of the flow.
- Fall back to the input messages only when loading, execution, or validation
  fails.
- Keep provider conversion in the runtime; do not require `assemble.ts` to emit
  provider-specific `ModelMessage[]`.

Initial assemble input contract:

```ts
export type AssembleInput = {
  sessionID: string
  sessionDir: string
  workspaceRoot: string
  directory: string
  step: number
  messages: MessageV2.WithParts[]
  session: Session.Info
  agent: {
    name: string
  }
  model: {
    id: string
    providerID: string
  }
}
```

Field notes:

- `messages` are the current SQLite-backed session messages after compaction
  filtering and reminder insertion.
- `sessionDir` is the global session ID directory for local discovery.
- `workspaceRoot` is the project worktree root.
- `directory` is the active working directory for the request.
- `step` identifies the current request/tool loop step.
- `session`, `agent`, and `model` are metadata only. The assemble script should
  not depend on internal services.

Initial assemble output contract:

```ts
export type AssembleOutput = MessageV2.WithParts[]
```

Validation rules:

- The output must be an array.
- Each item must contain `info` and `parts`.
- `info.role` must be `user` or `assistant`.
- `parts` must be an array.
- Invalid output falls back to `input.messages`.

Default session template:

```ts
// Runs before opencode converts messages to provider-specific model messages.
// Input:
// - input.messages is MessageV2.WithParts[] after compaction filtering and reminder insertion.
// - each item is { info, parts }; info.role is "user" or "assistant" and determines info fields.
// - parts contains typed message parts such as text, tool, file, reasoning, step-start, and step-finish.
// Return MessageV2.WithParts[]; do not return provider messages like { role, content }[].
// Edit this file to customize this session's context; changes apply on the next request.
export default async function assemble(input) {
  return input.messages
}
```

Non-goals for the first implementation:

- Do not port the old LanceDB bootstrap logic.
- Do not add `context_mode` config.
- Do not make the runtime understand module names like `necessary`, `team`,
  `history`, or `skill`.
- Do not let `assemble.ts` bypass provider conversion or tool permissions.

## Change Log

### 2026-05-10: Create Session ID Directory

Purpose:

- Establish a stable filesystem location for each session.
- Prepare for session-level context assembly and session tool discovery.

Files changed:

- `packages/opencode/src/session/session.ts`

Input:

- `Session.create` or `Session.fork` creates a new `Session.Info` object.
- `Global.Path.data` provides the global opencode data root.

Output:

- Creates `{Global.Path.data}/session/{sessionID}/`.
- Writes `{Global.Path.data}/session/{sessionID}/metadata.json`.

Metadata fields:

- `id`
- `project_id`
- `workspace_id`
- `parent_id`
- `directory`
- `path`
- `title`
- `time`

Notes:

- Session deletion does not remove the directory yet. This avoids deleting user
  authored session files by accident.
- The directory is initialized before the session creation event is published.

### 2026-05-10: Add Session Assemble Runtime

Purpose:

- Delegate context composition to each session directory.
- Keep provider conversion and tool permission handling in the runtime.
- Support edit-and-run behavior for `{Global.Path.data}/session/{sessionID}/assemble.ts`.

Files changed:

- `packages/opencode/src/session/session.ts`
- `packages/opencode/src/session/assemble-template.ts`
- `packages/opencode/src/session/script.ts`
- `packages/opencode/src/session/assemble.ts`
- `packages/opencode/src/session/prompt.ts`
- `specs/custom-session-flow.md`

Input:

- `Session.create` or `Session.fork` creates `{Global.Path.data}/session/{sessionID}/assemble.ts` and `assemble-schema.md` when missing.
- `SessionAssemble.run` receives the current compacted/reminder-adjusted `MessageV2.WithParts[]`, session metadata, agent name, model ID, provider ID, step, workspace root, and active directory.

Output:

- `assemble.ts` returns `MessageV2.WithParts[]`.
- The runtime passes the assembled messages through the existing plugin transform and `MessageV2.toModelMessagesEffect`.

Loader behavior:

- Uses `Bun.Transpiler` instead of dynamic `import()` to avoid ESM module cache issues.
- Caches by filepath and source content.
- Recompiles automatically on the next request after the source changes.
- Supports `export default function` / `export default async function`; script imports are intentionally unsupported.

Minimal test added:

- `packages/opencode/src/session/script.test.ts` verifies that unchanged script source reuses the cached function and changed source reloads on the next call.
- Minimal loader test passes when run outside the package bunfig preload path: `bun test "D:\llm\opencode-custom\packages\opencode\src\session\script.test.ts" --timeout 30000` from `D:\llm`.
- Package-local test execution in this shell is currently blocked before the test body runs: `bun test src/session/script.test.ts --timeout 30000` fails while resolving the package bunfig preload `@opentui/solid/preload`.
- `bun typecheck` is also blocked in this shell while resolving the catalog tsconfig path `@tsconfig/bun/tsconfig.json`.

### 2026-05-11: Document Default Assemble Contract In Template

Purpose:

- Make every newly created session self-document the assemble hook contract.
- Clarify that `assemble.ts` receives and returns internal `MessageV2.WithParts[]`, not provider messages.

Files changed:

- `packages/opencode/src/session/session.ts`
- `packages/opencode/src/session/assemble-template.ts`
- `specs/custom-session-flow.md`

Notes:

- The template is owned by `session/assemble-template.ts`; `session.ts` only calls `SessionAssembleTemplate.ensure(dir)` during directory initialization.
- The default template includes modular-style JSON discovery under the session directory. Files with `{ "assemble": true, "content": "..." }` become synthetic text messages; optional `position`, `timestamp`/`time`, and `countdown` fields control placement and lifetime.
- `session/assemble.ts` also calls `SessionAssembleTemplate.ensure(dir)` before loading the hook, so deleting a session's `assemble.ts` or `assemble-schema.md` restores the default files on the next request.
- `assemble-schema.md` documents the complete `MessageV2.WithParts[]` return schema, including user/assistant `info`, all supported part types, ID prefixes, and a minimal synthetic text example.
- If the hook fails to load, throws, or returns an invalid shape, the runner appends a temporary synthetic system reminder to the fallback messages so the agent tells the user to fix `assemble.ts`; the reminder is not persisted and disappears once the hook succeeds.
- Keep the template independent from the assemble runtime so the loader, runner, and session bootstrap can evolve separately.

### 2026-05-11: Remove Bun Runtime Calls From Desktop Sidecar Session Path

Purpose:

- Avoid `ReferenceError: Bun is not defined` when the packaged desktop sidecar runs under Electron/Node instead of Bun.
- Keep the send-session path free of direct `Bun.*` calls before `streamText(...)` executes.

Files changed:

- `packages/opencode/src/session/session.ts`
- `packages/opencode/src/session/assemble-template.ts`
- `packages/opencode/src/session/llm.ts`
- `packages/opencode/src/session/prompt.ts`
- `specs/custom-session-flow.md`

Notes:

- Replaced session bootstrap file writes and existence checks with `node:fs/promises`.
- Replaced session system prompt override reads and LLM request log writes with `node:fs/promises`; request logging no longer blocks on `Bun.write` in Node sidecar builds.
- Replaced session tool discovery `Bun.Glob` with `fs.readdir` for top-level `.ts`/`.js` files, matching the documented session tool directory behavior.
- Simplified the default `assemble.ts` template to return `input.messages`; this prevents newly generated session templates from embedding `Bun.file`, `Bun.Glob`, or `Bun.write` into code executed by the Node sidecar.
- Runtime `Bun.*` references under `packages/opencode/src/session` are now limited to tests.

### 2026-05-11: Allow Explicit Session ID On Create

Purpose:

- Support stable manager-agent sessions whose filesystem directory is known before first launch.
- Let clients call `POST /session` with an explicit `id` and `title`, then reuse the same `{Global.Path.data}/session/{sessionID}/` for JSON context and tools.

Files changed:

- `packages/opencode/src/session/session.ts`
- `specs/custom-session-flow.md`

Notes:

- `Session.CreateInput` now accepts optional `id: SessionID`.
- `Session.create` passes `input.id` through to the existing `createNext` path.
- Default session creation remains unchanged when `id` is omitted.
- This is create-only behavior; callers that want ensure semantics should still `GET /session/{id}` first and create only on not found.

### 2026-05-11: Add Minimal Manager Agent Frontend Entry

Purpose:

- Make the default desktop renderer a minimal chat surface bound to a stable manager-agent session.
- Keep the sidecar/backend as the single capability layer while allowing alternate frontend shapes.

Files changed:

- `packages/app/src/app.tsx`
- `packages/app/src/pages/manager.tsx`
- `packages/sdk/js/src/v2/*`
- `specs/custom-session-flow.md`

Notes:

- The root route `/` now renders the minimal manager page without the classic desktop layout.
- The classic desktop home remains available at `/classic`; existing project/session routes remain under `/:dir/session/:id?`.
- The manager page ensures fixed session `ses_manager_agent` with title `管理agent`, creating it through `POST /session` when missing.
- The page lists visible connected models and sends prompts to the fixed session with the selected provider/model.
- Proxy input is currently local-only documentation/UI state. The sidecar already reads `HTTP_PROXY`/`HTTPS_PROXY` from environment at startup, but there is no desktop UI/API yet to persist proxy settings into sidecar launch env or restart sidecar automatically.
- Follow-up work: add a desktop-side proxy settings entry that writes proxy env values, preserves loopback `NO_PROXY`, and restarts sidecar or prompts for app restart.

### 2026-05-12: Restore Classic Desktop as Default Entry

Purpose:

- Make the desktop root route show the classic home layout again.
- Keep the minimal manager-agent frontend available as an alternate entry.

Files changed:

- `packages/app/src/app.tsx`
- `specs/custom-session-flow.md`

Notes:

- The root route `/` now renders the classic desktop home inside the normal app shell.
- The minimal manager page moved to `/manager`, where it still bypasses the classic app shell.
- The existing `/classic` alias remains available for compatibility.
- `packages/app` typecheck is currently blocked in this Windows checkout because `packages/app/src/custom-elements.d.ts` and `packages/enterprise/src/custom-elements.d.ts` are Git symlinks checked out as ordinary files containing `../../ui/src/custom-elements.d.ts`; leave this unresolved while `dev:desktop` is running because deleting/recreating the watched files can interrupt the live desktop process.

### 2026-05-12: Add Standalone Manager Dev Frontend

Purpose:

- Allow opening the minimal manager frontend in a separate browser page while keeping the classic desktop window and its session intact.
- Reuse the existing sidecar connection through a dev-only local proxy instead of starting another backend.

Files changed:

- `packages/desktop/src/main/index.ts`
- `packages/desktop/scripts/manager-dev.ts`
- `packages/desktop/package.json`
- `specs/custom-session-flow.md`

Notes:

- In development, desktop writes `{userData}/sidecar.json` with the current sidecar URL and Basic Auth credentials after choosing the sidecar port/password.
- `bun --cwd packages/desktop manager:dev` reads that file, starts a local-only browser frontend on `127.0.0.1:17686`, and proxies `/api/*` to the existing sidecar with Basic Auth attached.
- The classic desktop window remains unchanged; this is only a debugging/inspection frontend.

## Open Design Items

- Define session tool declaration format and permission scope.
- Define how session skills differ from project/global skills.
- Define cleanup, archive, and export behavior for session directories.
