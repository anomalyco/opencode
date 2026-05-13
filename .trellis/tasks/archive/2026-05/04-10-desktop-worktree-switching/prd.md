# Desktop Worktree Switching

## Goal

Clarify whether OpenCode Desktop should support switching worktrees from the composer Git menu, and record the current architectural constraints before implementation.

## Current Findings

- Desktop already renders the shared app shell from `packages/app`, so composer-level Git/worktree UX changes will flow into desktop without a separate desktop-only implementation.
- The backend already models git root and current working directory separately.
  - `Project.fromDirectory(...)` resolves both the project `worktree` and the active `sandbox`/directory.
  - `Instance` context is keyed by `directory`, not only by project id.
  - `vcs.get` already returns branch list and parsed git worktrees.
  - Worktree lifecycle APIs already exist for create/remove/reset.
- The current composer Git popover already shows branch and worktree information, but its worktree list is read-only.
- The sidebar in `packages/app` already has a stronger workspace/worktree model:
  - enable/disable workspaces per git project
  - create workspace/worktree
  - rename/reset/delete workspace
  - navigate into a workspace by directory
- Existing e2e coverage already validates workspace enable/create/reset/delete/reorder behavior in the shared app.

## Product Semantics Confirmed So Far

- A worktree is a directory / checkout context.
- A session is a specific conversation thread.
- A single worktree can have multiple sessions.
- Current system behavior and data flow are directory-oriented in many places:
  - project discovery
  - instance bootstrapping
  - VCS state
  - diff / revert / snapshot behavior
  - sidebar workspace grouping

## Important Constraint

The UX should not imply that an existing session can be safely moved across worktrees while preserving the same conversational identity.

Why:

- Session behavior is tightly coupled to the directory where edits, diffs, snapshots, and revert operations happen.
- Reusing one session id across two different worktrees would blur which filesystem state earlier messages belong to.
- This creates confusing or unsafe semantics for history, diff display, revert, and future agent actions.

## Implication

If we add “switch worktree” to the composer Git menu, the action should most likely mean:

1. switch the active directory to the selected worktree
2. load that worktree’s existing conversational context
3. open the most recent relevant session for that worktree, or create one if none exists

It should not mean:

- keep the exact current session id and simply retarget it to another worktree

## Updated Recommendation

After reviewing the current session and workspace model more closely, the preferred direction is to avoid composer-level worktree switching entirely for existing sessions.

Recommended product model:

- A session is bound to a specific `directory` / worktree at creation time.
- The composer Git context should display branch and worktree as read-only metadata for the current session.
- Worktree selection should move to the new session flow.
- Once a session is created, its worktree binding should not change.
- The session list should include sessions from all worktrees belonging to the current git project.
- Sessions that belong to non-primary worktrees should show a secondary worktree indicator, ideally branch-first and path-second.

This keeps the session model consistent with existing backend behavior, where sessions already persist a `directory`, and avoids implying that a live conversation can safely jump between different filesystem states.

## Refined UX Direction

### Composer Git Context

- Keep branch and worktree visible.
- Remove worktree selection from the composer Git menu.
- Do not allow switching the current session to another worktree from the composer.
- Optional follow-up actions can remain non-destructive, such as:
  - reveal current worktree path
  - open or filter sessions for the current worktree

### New Session Flow

The new session entry point should become the only place where users choose execution context.

Suggested options:

1. Current worktree
2. Existing secondary worktrees
3. Create new worktree

Behavior:

- Choosing an existing worktree creates the session directly in that worktree.
- Choosing “create new worktree” first provisions the worktree, then creates the session bound to the new directory.
- The resulting session remains attached to that directory for its lifetime.

### Session List

Instead of hiding secondary worktree sessions or forcing users through a worktree switcher:

- list all root sessions across the current project’s main worktree and sandboxes
- visually mark sessions from secondary worktrees
- show a short branch or workspace label for those sessions
- opening a session should restore that session’s directory context before rendering it

This addresses the main usability issue directly:

- secondary worktree sessions become discoverable and manageable
- multiple sessions in the same secondary worktree become first-class
- users navigate by session, not by an implicit “jump to latest worktree session” rule

## Comparison With T3 Code

T3 Code treats worktree/branch selection primarily as thread environment selection:

- local thread: work in current branch
- worktree thread: create isolated worktree + branch
- branch selection happens when creating the thread/worktree
- multiple threads can reuse the same worktree

This is closer to “switch to another worktree’s conversation context” than “teleport the current session into another worktree”.

The updated recommendation for OpenCode Desktop aligns more closely with that model:

- choose worktree when creating the conversation
- keep thread/session identity stable afterward
- navigate between worktrees by opening sessions that already belong to them

## Open Questions

- Should the session list show only root sessions across all worktrees, or should child/fork sessions also be included in the unified view?
- What is the best compact indicator for secondary worktree sessions: branch icon, workspace icon, branch chip, or relative path?
- In the new session flow, should “create new worktree” be inline with existing choices or a nested modal/action?
- When opening a session from a secondary worktree, should the app preload that worktree context before navigation or transition after route change?

## Non-Goals For Initial Scope

- General branch checkout from the composer popover
- Moving a live session id across worktrees
- Supporting in-place worktree reassignment for existing sessions
- Reworking the sidebar workspace model
- Replacing the existing workspace management entry points

## Proposed Implementation Checklist

### Backend / API

- Extend `session.create` to accept an optional target `directory`.
- Validate that the provided directory belongs to the current project worktree set.
- Keep session/worktree binding immutable after creation.

### Shared App UI

- Remove composer-level worktree selection for existing sessions.
- Update new session UI to select current worktree, existing worktree, or create a new worktree.
- Route newly created sessions into the selected directory context.
- Update session lists to aggregate root sessions from the main worktree and all secondary worktrees.
- Add a clear visual marker for sessions from non-primary worktrees.

### Behavior Checks

- Creating a session in the main worktree still works unchanged.
- Creating a session in an existing secondary worktree works without global retargeting.
- Creating a new worktree and session in one flow works.
- Opening a secondary-worktree session restores the correct directory, branch, and file context.
- The composer no longer suggests that an active session can be switched across worktrees.
