# Agent Worktree Isolation

## ADDED Requirements

### Requirement: A change's agent work happens in a dedicated worktree
When worktree isolation is enabled, work on an openspec change SHALL happen in
a dedicated git worktree at `../opencode-worktrees/<slug>` relative to the
repository root, rather than in the shared main checkout.

#### Scenario: First run on a change
- **WHEN** a loop starts work on a change with no existing worktree for its
  slug
- **THEN** a new worktree and branch are created at
  `../opencode-worktrees/<slug>` and the work happens there

#### Scenario: Resuming a change
- **WHEN** a loop starts work on a change whose worktree already exists
  (created by a prior run, or by the external `skein` orchestrator using the
  same convention)
- **THEN** the existing worktree is reused rather than duplicated

### Requirement: Concurrent changes do not share a working directory
Two changes being worked on at the same time SHALL each have their own
worktree, so a git operation (branch switch, commit) in one cannot affect the
other.

#### Scenario: Two loops running at once
- **WHEN** one loop is working on change A and another on change B
  concurrently
- **THEN** each operates in its own worktree and neither's branch or working
  tree state is affected by the other's git operations

### Requirement: Completed work merges locally and never pushes
On successful completion of a change's work, the worktree's branch SHALL be
merged into the main checkout locally. The merge SHALL NOT push to any
remote.

#### Scenario: Successful completion
- **WHEN** a change's work completes successfully in its worktree
- **THEN** the branch is merged into the main checkout's current branch with
  no push, and the worktree is then removed

#### Scenario: Halted or failed work
- **WHEN** a change's work halts or fails before completion
- **THEN** the worktree is left in place, unmerged, for inspection or manual
  resumption — it is not silently discarded

### Requirement: Isolation is opt-in
Worktree isolation SHALL be disabled by default and only take effect when
explicitly enabled via configuration.

#### Scenario: Default configuration
- **WHEN** no configuration explicitly enables worktree isolation
- **THEN** loops behave exactly as before this change, operating in the main
  checkout
