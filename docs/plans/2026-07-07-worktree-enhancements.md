# Worktree Enhancements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the TUI worktree/workspace feature useful for daily development workflow.

**Architecture:** Four independent enhancements: (1) show workspace name in agent status bar, (2) branch-per-worktree instead of detached, (3) `/switch` quick command, (4) richer workspace list dialog with branch/timeUsed. Auto-cleanup deferred — needs background scheduler and DB cleanup logic.

**Tech Stack:** TypeScript, Effect, SolidJS (TUI), Drizzle (DB)

---

### Task 1: Status Indicator — Workspace Name in Agent/Model Info Bar

**Files:**
- Modify: `packages/tui/src/component/prompt/index.tsx:1437-1478`

**Changes:**
Add a `Match` for `workspace.label()` in the agent info bar (the top bar showing agent name and model). This shows the workspace name always visible, not just in the status bar below.

```tsx
<Match when={workspace.label()}>
  <box>
    <text dimColor>WS</text>
    <text> </text>
    <text>{workspace.label()!.workspaceName}</text>
  </box>
</Match>
```

---

### Task 2: Branch-Per-Worktree

**Files:**
- Modify: `packages/opencode/src/control-plane/adapters/worktree.ts:35`

**Changes:**
Change `detached: true` → `detached: false` so worktree auto-creates branch `opencode/{name}`.

---

### Task 3: Quick Switch — `/switch` Command

**Files:**
- Modify: `packages/tui/src/component/prompt/index.tsx:531-540` (add command)
- Modify: `packages/tui/src/component/prompt/workspace.tsx` (add switch function)

**Changes:**
Add `/switch` command that opens the workspace list dialog (same as `/workspaces`). Session warp happens when user selects a workspace from the list.

---

### Task 4: Visual Diff in Workspace List Dialog

**Files:**
- Modify: `packages/tui/src/component/dialog-workspace-list.tsx`

**Changes:**
When expanded, also show:
- Branch name (if available)
- Time used (relative, like "2h ago")

---

### Task 5: Fix Workspace Create Flow

**Files:**
- Fix already applied: workspace-adapter-runtime.ts and worktree/index.ts

**Changes:**
Already done in prior session. Ensure workspace ID is passed to boot context and Event.Status is emitted.
