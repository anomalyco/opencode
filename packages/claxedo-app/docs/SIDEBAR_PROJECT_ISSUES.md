# Sidebar Project Issues (Claxedo)

## Thesis
The rail sidebar becomes unreliable when it tries to merge **two different sources of truth** with the same rules:

- **Local server**: a *user-curated* list of projects (persisted in the UI).
- **Cloud/gateway server**: an *authoritative* list of projects from the server API (projects exist server-side, so hiding them locally is incorrect).

If we treat both the same (auto-adding API projects locally, or persisting “closed” state for cloud), the sidebar drifts: projects reappear, disappear, or get stuck as “hidden” across reloads.

## Why “Closed Projects” Exists (and When It Should Not)
“Closed/removed from list” is only useful when the sidebar list is *manual* (local server):

- You remove a project from the list and you expect it to stay removed.

For cloud/gateway servers, the sidebar list should not be “curated”:

- The server already knows which projects exist.
- The UI should always reflect the server list (show all projects), and only store *presentation state* (expanded/collapsed, ordering preference).

## Root Causes (Observed Failure Modes)
- **Cloud list polluted by local persistence**: “Remove from list” (or sandbox/root consolidation) wrote to `closedProjects`, permanently hiding cloud projects.
- **Auto-sync vs. user intent mismatch**: blindly “opening” API projects in the local list makes local behavior diverge from upstream/manual workflows.
- **Unsafe worktree inputs**: invalid/garbage directories (including `"/"` or decode failures) can enter persistence and cascade into UI + sync issues.
- **Sandbox/root normalization using `close()`**: internal cleanup (“replace sandbox entry with root”) should not be treated as an explicit user close.

## Solid Plan (Target Model)
1. **Validate worktrees everywhere**
   - Introduce `validWorktree()` and reject invalid directories at the boundary (decode, open/close, sync).
2. **Separate user intent from cleanup**
   - `projects.close(dir)` = user “remove from list” (local only) + add to `closedProjects`.
   - `projects.remove(dir)` = cleanup-only (never adds to `closedProjects`).
3. **Cloud behavior: server is authoritative**
   - Reconcile sidebar projects to *all* API projects via `projects.sync([...])`.
   - Preserve user UI state (expanded/collapsed, ordering where possible).
   - Hide “Remove from list” in cloud UI.
4. **Local behavior: upstream-like manual list**
   - Do **not** auto-sync API projects into the sidebar list.
   - “Remove from list” is available and persistent.
5. **Safe routing decode**
   - Base64 decode can fail; only use decoded dirs if `validWorktree()` passes.

## Success Criteria
- Cloud: sidebar always shows the full server project list after sync; no project can be permanently hidden by local persistence.
- Local: sidebar remains user-curated; removed projects stay removed.
- Invalid worktrees never enter persisted state.

