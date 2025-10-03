# Tool Authoring Guide

This project now ships shared helpers so every tool behaves consistently.

## Instrumentation
- Wrap long-running work with `measure({ id, ctx, params, run })` from `packages/opencode/src/tool/telemetry.ts`.
- Each call logs execution duration, call id, and status, helping us spot slow or flaky commands while developing with `bun dev`.
- `measure()` also publishes a `tool.telemetry` bus event. The TUI subscribes and renders these entries in real time (`tele  | ToolName 0.42s`). Tap into the same stream via `Bus.subscribe(ToolTelemetry.Event.Sampled, ...)` for custom dashboards.

## Workspace Safety
- Use `guard()` from `packages/opencode/src/tool/workspace.ts` to resolve paths and enforce the workspace boundary.
- Pass `message` if you need a custom error; pass `bypass: true` only for trusted internal flows.
- Tools such as `edit`, `write`, `multiedit`, and `patch` already wrap user-provided paths with `guard()`. Follow the same pattern when building new file mutators.

## Troubleshooting
- If you see `tool.telemetry` entries with `status=error`, inspect the associated `error` string—it's propagated from the thrown exception.
- Workspace errors typically originate from `guard()`. Confirm the tool receives absolute paths rooted in `Instance.directory` or set `bypass` explicitly for trusted cases (e.g., generated temp files).
- When adding tests around I/O, use `tmpdir()` to create and clean up isolated directories; the helper ensures telemetry logs stay focused on the test workspace.
- For tool stats, run `opencode stats`. The display now groups the last session’s telemetry entries by tool, listing total runs, average duration, and error count so you can spot hotspots quickly.

## Plugin Tools
- Plugin authors can return either a plain string or `{ output, title?, metadata? }`.
- See `packages/plugin/src/tool.ts` for the unified `ToolDefinition` and `ToolResult` types.

## Testing
- Prefer table-driven tests under `packages/opencode/test/tool`. Use `tmpdir()` to create isolated workspaces.
- Capture streamed metadata (see `bash.test.ts`) to ensure tools emit incremental updates as expected.

Small, consistent helpers keep our tool surface predictable and easier to debug. Add to this document whenever you introduce new patterns that other contributors should follow.
