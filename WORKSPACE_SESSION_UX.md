# Workspace & Session UX Specification

**Status:** Final Specification  
**Date:** 2026-02-04  
**Purpose:** Define the user experience for session-first architecture with worktree as configuration

---

## Core Principles

1. **Sessions are primary** - Users work in sessions, worktrees are optional configuration
2. **Worktree is session configuration** - Like choosing model/agent, worktree is chosen at session creation
3. **No forced hierarchy** - Sessions are not nested under workspaces in the UI
4. **WorkspaceBar for context** - Sets default worktree and optional filtering
5. **Sidebar for history** - Pure navigation, no filtering behavior

---

## Mental Model

### Sessions vs Workspaces

```
Sessions = Active work area (browser tabs)
├── Chat 1 [worktree: main]
├── Chat 2 [worktree: feature-auth]
└── Terminal [worktree: feature-ui]

Worktrees = Execution context (git worktrees)
├── main (project.worktree)
├── feature-auth (sandbox)
└── feature-ui (sandbox)
```

**Key:** Sessions reference worktrees, but are not "owned" by them.

### Worktree Purpose

**Primary:** Execution isolation for parallel AI agents

- Agent 1 working on feature-auth → separate worktree
- Agent 2 working on feature-ui → different worktree
- Prevents file conflicts

**Secondary:** Organizational grouping

- Multiple sessions can work in same worktree
- User's responsibility to coordinate (like git branches)

---

## UI Components

### 1. Left Sidebar (RailSidebar)

**Purpose:** Session history and navigation

```
Projects
└── Project A (expandable)
    └── Sessions (flat list)
        ├── Chat 1                      (2m ago)
        ├── Chat 2                      (5m ago)
        ├── Chat 3                      (1h ago)
        ├── ...
        └── Chat 10                     (1d ago)
        ↓ (infinite scroll for more)
```

#### Behavior

- ✅ **Flat list** - No workspace grouping
- ✅ **Recent first** - Sorted by last updated time
- ✅ **Initial load** - Show 10 most recent sessions
- ✅ **Infinite scroll** - Load more on scroll
- ✅ **Click session** - Opens tab in TopTabBar
- ✅ **Click project** - Expand/collapse (NO workspace sync, NO filtering)

#### Right-Click Menus

Keep existing right-click menus as they are now. Remove any workspace-related options.

---

### 2. WorkspaceBar

**Purpose:** Set default worktree and optional filtering

```
┌──────────────────────────────────────────────────────────────┐
│  [Project] / main / feature-auth / feature-ui  [+]           │
│              ^^^^   ^^^^^^^^^^^^^   ^^^^^^^^^^                │
│            default   workspace     workspace                  │
└──────────────────────────────────────────────────────────────┘
```

#### Click Behavior

**Single Click: Set as Default**

```
User clicks "feature-auth" (once)
→ Sets default worktree = feature-auth
→ Visual: feature-auth becomes bold
→ [+ Session] creates in feature-auth
→ NO filtering (all tabs still visible in TopTabBar)
```

**Double Click: Set Default + Pin Filter**

```
User double-clicks "feature-auth"
→ Sets default worktree = feature-auth
→ Pins filter = feature-auth
→ Visual: feature-auth shows bold + underline
→ [+ Session] creates in feature-auth
→ TopTabBar filtered to only show feature-auth tabs
```

**Click Already-Pinned: Unpin Filter**

```
User double-clicks "feature-auth" (already pinned)
→ Unpins filter
→ Default stays feature-auth
→ Visual: removes underline, stays bold
→ TopTabBar shows all tabs again
```

**Click Different Workspace (while one is pinned):**

```
Current: feature-auth (underlined)
User single-clicks "feature-ui"
→ Unpins feature-auth
→ Sets default = feature-ui
→ Visual: feature-ui becomes bold (no underline)
→ TopTabBar shows all tabs
```

#### Visual States

| State            | Visual                            | Behavior                                      |
| ---------------- | --------------------------------- | --------------------------------------------- |
| **Initial**      | `main` (bold)                     | Default = main, No filter                     |
| **Default only** | `feature-auth` (bold)             | Default = feature-auth, No filter             |
| **Pinned**       | `feature-auth` (bold + underline) | Default = feature-auth, Filter = feature-auth |

#### Create Worktree Button `[+]`

```
User clicks [+]
→ Opens dialog: "Create worktree"
→ Input: name (e.g., "feature-new")
→ Creates git worktree
→ Sets as default (bold)
→ Does NOT pin filter
```

---

### 3. TopTabBar

**Purpose:** Active sessions/terminals (work area)

```
┌──────────────────────────────────────────────────────────────┐
│  Chat 1  |  Chat 2 [🌳 auth]  |  Terminal [🌳 ui]  |  + ▼    │
└──────────────────────────────────────────────────────────────┘
```

#### Tab Display

**Worktree Badge:**

- Show `[🌳 worktree-name]` for non-main worktrees AND when no worktree filter is active
- No badge for main worktree (cleaner)
- No badge when worktree filter is pinned (redundant - all visible tabs are in same worktree)
- Badge always visible when shown (not just on hover)

**Hover Tooltip:**

- Show additional worktree info
- Format: `🌳 feature-auth` or `🌳 feature-auth (branch: feat/auth)`

#### Filtering

**When NOT pinned (default state):**

```
Shows ALL tabs regardless of worktree
├── Chat 1
├── Chat 2 [🌳 feature-auth]
├── Terminal [🌳 feature-ui]
└── Chat 3
```

**When pinned (e.g., feature-auth underlined):**

```
Shows ONLY tabs in feature-auth worktree
├── Chat 2
└── Terminal 2

(Other tabs hidden but still exist)
(No badges needed - all visible tabs are in same worktree)
```

#### Create Session/Terminal

**`[+ Session]` / `[+ Terminal]` buttons:**

```
Always uses "Default" worktree from WorkspaceBar
No dropdown needed
One-click creation
```

---

## User Workflows

### Workflow 1: Starting Fresh

```
1. User opens project
   WorkspaceBar: main (bold)
   TopTabBar: (empty)
   Sidebar: Shows recent sessions (history)

2. User clicks [+ Session]
   → Creates session in "main" worktree
   → TopTabBar: Chat 1

3. User wants to work on feature in isolation
   → Clicks [+] in WorkspaceBar
   → Dialog: "Create worktree: feature-auth"
   → WorkspaceBar: main / feature-auth (bold)
   → TopTabBar: Chat 1 (still visible, no filter)

4. User clicks [+ Session]
   → Creates session in "feature-auth"
   → TopTabBar: Chat 1 | Chat 2 [🌳 feature-auth]
```

### Workflow 2: Context Switching

```
Current state:
WorkspaceBar: main (bold) / feature-auth / feature-ui
TopTabBar: Chat 1 | Chat 2 [🌳 auth] | Terminal [🌳 ui] | Chat 3

User wants to focus on feature-auth work:
→ Double-clicks "feature-auth" in WorkspaceBar
→ WorkspaceBar: main / feature-auth (underlined) / feature-ui
→ TopTabBar: Chat 2 [🌳 auth] (others hidden)
→ [+ Session] creates in feature-auth

User wants to see all tabs again:
→ Double-clicks "feature-auth" again (unpin)
→ WorkspaceBar: main / feature-auth (bold) / feature-ui
→ TopTabBar: Chat 1 | Chat 2 [🌳 auth] | Terminal [🌳 ui] | Chat 3
```

### Workflow 3: Parallel Feature Development

```
User working on multiple features:

1. Click "feature-auth" → sets default
   [+ Session] → Chat about auth implementation
   [+ Terminal] → Test auth endpoints

2. Click "feature-ui" → changes default
   [+ Session] → Chat about UI components
   [+ Terminal] → Run dev server

3. Click "main" → back to main
   [+ Session] → Review overall changes

All tabs visible unless pinned
Each session executes in its configured worktree
```

### Workflow 4: Using Sidebar for Navigation

```
User has many tabs open across worktrees

Sidebar shows:
├── Chat 5   (5m ago) ← Recent work
├── Chat 3   (1h ago)
├── Chat 1   (2h ago)
└── ...

User clicks "Chat 3" in sidebar
→ Opens/focuses Chat 3 tab in TopTabBar
→ Does NOT change WorkspaceBar default or filter
→ Pure navigation
```

---

## Data Model

### Session

```typescript
Session {
  id: string
  directory: string           // Worktree path (main or sandbox)
  projectID: string
  title: string
  // Worktree name derived from: basename(directory)
  // Or lookup in project.sandboxes
}
```

### Project

```typescript
Project {
  id: string
  worktree: string              // Main repo path
  sandboxes: string[]           // Additional worktree paths
  // All worktrees are persistent (no ephemeral concept)
}
```

### Layout State

```typescript
{
  workspace: {
    default: string,        // Current default worktree directory
    pinned: string | null   // Pinned filter (null = show all)
  },

  tabs: {
    active: string,              // Active tab ID
    all: Array<{
      id: string,
      type: "session" | "terminal" | "review",
      directory: string          // Worktree this tab uses
    }>
  }
}
```

---

## Implementation Checklist

### Phase 1: Sidebar Refactor

- [ ] Remove workspace grouping in RailSidebar
- [ ] Flatten session list (sorted by updated time)
- [ ] Show initial 10 sessions
- [ ] Implement infinite scroll for more sessions
- [ ] Remove workspace sync on project click
- [ ] Update right-click menus (remove worktree options)

### Phase 2: WorkspaceBar Click Behavior

- [ ] Implement single-click → set default (bold visual)
- [ ] Implement double-click → pin filter (underline)
- [ ] Implement click-pinned → unpin filter
- [ ] Click different workspace → change default, clear pin
- [ ] Visual states: bold for default, underline for pinned
- [ ] Persist default/pinned state in layout context

### Phase 3: TopTabBar Filtering

- [ ] Show all tabs when no pin (default)
- [ ] Filter tabs by worktree when pinned
- [ ] Add worktree badges to tabs `[🌳 name]`
- [ ] Badge only for non-main worktrees
- [ ] Add hover tooltip with worktree info
- [ ] Update tab rendering based on filter state

### Phase 4: Session/Terminal Creation

- [ ] `[+ Session]` uses WorkspaceBar default worktree
- [ ] `[+ Terminal]` uses WorkspaceBar default worktree
- [ ] Remove worktree dropdowns (no longer needed)
- [ ] Session created with `directory = default worktree`
- [ ] Terminal spawned with `cwd = default worktree`

### Phase 5: Worktree Management

- [ ] `[+]` button in WorkspaceBar creates new worktree
- [ ] Set newly created worktree as default (no pin)
- [ ] Worktree creation dialog (name input)
- [ ] Update WorkspaceBar list after creation
- [ ] All worktrees are persistent (user manages lifecycle)

---

## Edge Cases & Clarifications

### What if all tabs in a worktree are closed?

- Worktree still shows in WorkspaceBar (persistent)
- Can still be selected as default
- Can still create new sessions in it

### What if user deletes a worktree that has open tabs?

The current codebase doesn't prevent worktree deletion when sessions exist or when there are uncommitted changes. If a worktree is deleted while tabs reference it, those sessions will execute in the main worktree instead. This is acceptable behavior - no special handling required.

### What if user switches default while agent is working?

- Active session continues in its worktree (unchanged)
- Only affects NEW sessions created with `[+ Session]`
- No impact on existing tabs

### What if user pins filter while multiple worktrees have tabs?

- Only tabs in pinned worktree are visible
- Other tabs hidden but still exist
- Can see them again by unpinning

### Can worktree be changed after session creation?

- **NO** - Worktree is set at creation time
- Cannot be changed mid-session
- User must create new session in different worktree

### What about terminals?

- Terminals work exactly like sessions
- Have worktree configuration (directory)
- Show badge `[🌳 name]` if not main
- Affected by WorkspaceBar filter
- Created in WorkspaceBar default worktree

---

## Open Questions

### 1. Double-click vs Toggle

**Current spec:** Actual double-click event  
**Alternative:** Click already-default workspace to toggle pin

Which feels better?

- Double-click (like file explorer)
- Toggle (like button)

### 2. Visual Style for Default (no pin)

**Decision:** Bold text

### 3. Pin/Filter Style

**Decision:** Underline works well as visual indicator for pinned/filtered state

### 4. Sidebar Session Limit

**Current spec:** Initial 10, infinite scroll  
**Alternative:** Show all with virtual scrolling

For 100+ sessions, which performs better?

### 5. Filter Persistence

**Should pinned filter persist across app restarts?**

- Yes: User returns to filtered view
- No: Always start unpinned (show all)

---

## Migration Notes

### From Current Workspace Hierarchy

**Old model:**

```
Project
└── Workspace
    └── Sessions
```

**New model:**

```
Project
└── Sessions (flat, each has worktree config)
```

**Migration:**

- Existing sessions keep their `directory` field (no change)
- Sidebar UI changes (remove grouping, show flat list)
- WorkspaceBar changes (click behavior, filtering)
- No data model changes needed

### Backward Compatibility

- ✅ Existing sessions work as-is (already have `directory`)
- ✅ Existing worktrees work as-is (in `project.sandboxes`)
- ✅ Only UI changes, no breaking data changes

---

## Future Enhancements

### Possible Extensions

1. **Worktree templates**
   - Create worktree with pre-configured setup scripts
   - Useful for consistent environments

2. **Worktree search in sidebar**
   - Filter sessions by worktree in sidebar
   - "Show only feature-auth sessions"

3. **Drag sessions to WorkspaceBar**
   - Drag session onto workspace to move it
   - Would require "change worktree" feature (currently not allowed)

4. **Worktree status indicators**
   - Show uncommitted changes count
   - Show branch info
   - Show if worktree is dirty

5. **Quick switch keyboard shortcuts**
   - Cmd+1/2/3 to switch default worktree
   - Cmd+Shift+F to toggle filter

---

## Success Criteria

User can:

- ✅ Create sessions without thinking about workspaces (defaults to main)
- ✅ Easily switch default worktree for new sessions (single click)
- ✅ Focus on specific worktree when needed (double-click to pin)
- ✅ Navigate session history regardless of worktree (sidebar)
- ✅ Work in parallel on multiple features (different worktrees)
- ✅ See at a glance which worktree each tab uses (badges)

Developer benefits:

- ✅ Simpler mental model (sessions first, worktree as config)
- ✅ No forced hierarchy in UI
- ✅ Clean separation of concerns (sidebar=history, workspacebar=context)
- ✅ Flexible filtering (optional, not mandatory)

---

**End of Specification**
