# Tool Authoring Guide

This project now ships shared helpers so every tool behaves consistently.

## Instrumentation
- Wrap long-running work with `measure({ id, ctx, params, run })` from `packages/opencode/src/tool/telemetry.ts`.
- Each call logs execution duration, call id, and status, helping us spot slow or flaky commands while developing with `bun dev`.

## Workspace Safety
- Use `guard()` from `packages/opencode/src/tool/workspace.ts` to resolve paths and enforce the workspace boundary.
- Pass `message` if you need a custom error; pass `bypass: true` only for trusted internal flows.

## Plugin Tools
- Plugin authors can return either a plain string or `{ output, title?, metadata? }`.
- See `packages/plugin/src/tool.ts` for the unified `ToolDefinition` and `ToolResult` types.

## Testing
- Prefer table-driven tests under `packages/opencode/test/tool`. Use `tmpdir()` to create isolated workspaces.
- Capture streamed metadata (see `bash.test.ts`) to ensure tools emit incremental updates as expected.

Small, consistent helpers keep our tool surface predictable and easier to debug. Add to this document whenever you introduce new patterns that other contributors should follow.
