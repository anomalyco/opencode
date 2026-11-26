# ACP session move rebinding

Date: 2026-11-26
Issue: #66573

## Intent

When OpenCode moves a session to another worktree, ACP clients must learn the new directory and the ACP process must continue using directory-scoped state from the new location. Today the session becomes unloadable from the client's original workspace after restart.

## Goals

- Deliver `session.moved` to attached ACP sessions as `session_info_update` with `_meta["opencode/directory"]`.
- Rebind the existing ACP attachment without changing its identity, preserving active and background turns.
- Reload the destination catalog and MCP registrations, and refresh config/command options.
- Use the current directory for in-flight permission previews/diffs and later prompts.
- Include the actual session directory in load/resume/fork mismatch errors for recovery.

## Non-goals

- Changing core `SessionMove` semantics or ACP's exact-`cwd` validation.
- Returning moved sessions in an old directory's `session/list`.
- Updating the unshipped Rust ACP client.

## Constraints

- `session.moved` is already a public durable event and reaches `OpenCodeClient.event.subscribe()`.
- `Attached` identity is used by active/background turn bookkeeping, so it must not be replaced.
- Catalog state and MCP registrations are directory-scoped.
- This is a bug fix; no feature flag or core protocol change is needed.

## Approaches

1. **Notify only.** Send the new directory but leave ACP's internal `cwd` unchanged. Small, but later prompts keep using stale catalog, MCP, and diff state. Rejected.
2. **Block ACP session moves.** Prevent an attached ACP session from moving. Avoids the symptom but breaks the worktree workflow and requires server-side attachment awareness. Rejected.
3. **Full rebind (chosen).** Handle `session.moved` in the ACP session manager, update the existing attachment, restart only its directory-scoped watchers, notify the client, and improve mismatch errors.

## Design

- Extend the session-level event subscription to include `session.moved`.
- Queue moves per attached session and process them serially.
- Update the existing attachment's current `cwd`, send `_meta["opencode/directory"]`, reload the destination catalog, restart only the catalog watcher, refresh config/command options, and re-register the client's MCP servers in the destination.
- Keep the entry scope for turn fibers; use a child scope for the catalog watcher so rebinding does not cancel active or background turns.
- Make turn context read the attachment's current directory, so permission previews and completed diffs after a move use the right base.
- Extend `SessionDirectoryMismatchError` with the actual `directory` and expose it in the error data and message.
- Document the new `_meta` key in the ACP protocol reference.

## Verification

- Add a wire test that attaches a session, emits `session.moved`, expects the directory notification, verifies destination catalog/MCP requests, and loads successfully with the new `cwd`.
- Add a wire test that moves during an active prompt and verifies later permission locations use the destination directory.
- Extend the mismatch-error test to assert the actual directory.
- Run the ACP session/turn tests and CLI typecheck; run the repository check when practical.
