# Workspace Git Panel - Feature Specification

## Overview

Add a **Git Panel** to Claxedo that provides workspace-level git integration with staging controls, branch comparison, and AI-powered code review capabilities.

### Goals

1. **Visibility**: See all git changes (staged/unstaged) at a glance
2. **Control**: Stage, unstage, and discard changes without leaving the app
3. **Comparison**: Compare current work against any branch
4. **Verification**: AI agent reviews changes for bugs, security issues, and correctness

### Non-Goals (Out of Scope)

- Commit creation (use terminal)
- Push/pull operations (use terminal)
- Merge conflict resolution
- Git history/log viewing
- Blame annotations

---

## User Journeys

### Journey 1: Quick Status Check

**As a developer**, I want to quickly see what files I've changed, so I can track my progress.

**Flow:**

1. User clicks the Git icon in the top tab bar
2. Git panel opens showing "Unstaged" tab by default
3. User sees list of modified files with +/- line counts
4. User can switch to "Staged" tab to see what's ready to commit

### Journey 2: Staging Changes

**As a developer**, I want to stage specific files for commit, so I can create atomic commits.

**Flow:**

1. User opens Git panel → Unstaged tab
2. User sees list of changed files
3. User clicks [+] button on individual files to stage them
4. File moves from Unstaged to Staged tab
5. Alternatively, user clicks "Stage All" to stage everything
6. User can undo by clicking [-] on staged files

### Journey 3: Discarding Changes

**As a developer**, I want to discard unwanted changes, so I can revert mistakes.

**Flow:**

1. User opens Git panel → Unstaged tab
2. User identifies file(s) to discard
3. User clicks [↩] (discard) button on the file
4. Confirmation dialog appears: "Discard changes to {filename}? This cannot be undone."
5. User confirms → changes are discarded
6. File disappears from the list (or shows as unchanged)

### Journey 4: Branch Comparison

**As a developer**, I want to see all changes between my branch and main, so I can review before creating a PR.

**Flow:**

1. User opens Git panel → "Branch Diff" tab
2. System auto-detects default branch (main/master) and shows it in dropdown
3. User sees all files that differ from the base branch
4. User can change base branch from dropdown to compare against different target
5. Each file shows cumulative +/- lines changed

### Journey 5: AI Code Review

**As a developer**, I want AI to review my changes before I commit, so I can catch bugs early.

**Flow:**

1. User opens Git panel
2. User selects scope: Unstaged, Staged, or Branch Diff tab
3. User clicks "Review" button
4. Loading indicator appears: "Analyzing changes..."
5. AI agent runs, examining each changed file
6. Results appear in the review panel below the file list:
   - Summary: "Found 2 issues, 1 suggestion"
   - Per-file breakdown with severity icons
   - Line-specific feedback with suggestions
7. User can click on a finding to see more details
8. User addresses issues, then runs review again if desired

### Journey 6: Reviewing Specific Files

**As a developer**, I want to review only certain files, not everything.

**Flow:**

1. User opens Git panel
2. User checks the checkbox next to specific files
3. "Review Selected (N)" button becomes active
4. User clicks it → AI reviews only those files
5. Results show only for selected files

---

## UI Specification

### Tab Bar Addition

```
┌─────────────────────────────────────────────────────────────────────┐
│ [≡] [Session Tab] [Terminal Tab] [+] [C] [X] [>_] [🔀] [⋮]        │
│                                                             ↑      │
│                                                     New Git Button │
└─────────────────────────────────────────────────────────────────────┘
```

- **Location**: After terminal button, before overflow menu
- **Icon**: Git branch icon (🔀 or custom SVG)
- **Tooltip**: "Git Status"
- **Behavior**: Opens/activates Git tab for current workspace

### Git Panel Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│ Git - project-name                                              [×] │
├─────────────────────────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────────────────────────────┐│
│ │ [Unstaged (5)] [Staged (2)] [Branch Diff]     Base: [▼ main]   ││
│ ├──────────────────────────────────────────────────────────────────┤│
│ │                                          [Review] [Stage All] [⟳]││
│ └──────────────────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────────────────┤
│ FILE LIST                                                           │
│ ┌──────────────────────────────────────────────────────────────────┐│
│ │ ☐ M  src/components/Button.tsx        +23  -5      [+] [↩]     ││
│ │ ☐ A  src/utils/helpers.ts             +45  -0      [+] [↩]     ││
│ │ ☐ M  src/pages/Home.tsx               +12  -8      [+] [↩]     ││
│ │ ☐ D  src/deprecated/old.ts            +0   -120    [+] [↩]     ││
│ │ ☐ ?  src/newfile.ts                   +30  -0      [+] [↩]     ││
│ └──────────────────────────────────────────────────────────────────┘│
├─────────────────────────────────────────────────────────────────────┤
│ AI REVIEW RESULTS (collapsible, shown after review)                 │
│ ┌──────────────────────────────────────────────────────────────────┐│
│ │ ▼ Review Summary                                                 ││
│ │   Found 2 issues, 3 suggestions across 5 files                   ││
│ ├──────────────────────────────────────────────────────────────────┤│
│ │ ▼ src/components/Button.tsx                              ⚠️     ││
│ │   └─ Line 23: Potential null reference - props.onClick may be   ││
│ │      undefined. Consider adding optional chaining.               ││
│ │   └─ Line 45: 💡 Consider memoizing this callback               ││
│ ├──────────────────────────────────────────────────────────────────┤│
│ │ ▶ src/utils/helpers.ts                                   ✅     ││
│ ├──────────────────────────────────────────────────────────────────┤│
│ │ ▼ src/pages/Home.tsx                                     🔴     ││
│ │   └─ Line 8: Security issue - User input not sanitized before   ││
│ │      rendering. XSS vulnerability.                               ││
│ └──────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
```

### Status Icons

| Icon | Meaning   | Color  |
| ---- | --------- | ------ |
| `M`  | Modified  | Yellow |
| `A`  | Added     | Green  |
| `D`  | Deleted   | Red    |
| `R`  | Renamed   | Blue   |
| `?`  | Untracked | Gray   |

### Review Severity Icons

| Icon | Meaning     | Color  |
| ---- | ----------- | ------ |
| 🔴   | Error/Bug   | Red    |
| ⚠️   | Warning     | Yellow |
| 💡   | Suggestion  | Blue   |
| ✅   | OK/Approved | Green  |

### Action Buttons

| Button              | Location                     | Action                               |
| ------------------- | ---------------------------- | ------------------------------------ |
| `[+]`               | Per file (unstaged)          | Stage this file                      |
| `[-]`               | Per file (staged)            | Unstage this file                    |
| `[↩]`              | Per file (unstaged)          | Discard changes (with confirmation)  |
| `[Review]`          | Header                       | Run AI review on current tab's files |
| `[Stage All]`       | Header (unstaged tab)        | Stage all files                      |
| `[Unstage All]`     | Header (staged tab)          | Unstage all files                    |
| `[⟳]`               | Header                       | Refresh status                       |
| `[Review Selected]` | Footer (when files selected) | Review only selected files           |

### Branch Selector

- Dropdown showing all local and remote branches
- Current branch marked with checkmark
- Remote branches marked with cloud icon
- Search/filter for large branch lists
- Default: auto-detected default branch (main/master/develop)

---

## Technical Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                          CLAXEDO APP                                │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ ClaxedoLayoutProvider                                           ││
│  │  └─ topTabs: { addGit(), ... }                                  ││
│  │  └─ TabContentArea (hosts)                                      ││
│  ├─────────────────────────────────────────────────────────────────┤│
│  │ DirectoryScope (via Portal)                                     ││
│  │  └─ WorkspaceProvider (git state)                               ││
│  │  └─ TabGit Component                                            ││
│  │       └─ GitFileList                                            ││
│  │       └─ GitReviewResults                                       ││
│  └─────────────────────────────────────────────────────────────────┘│
│                              │                                       │
│                              ▼                                       │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │                      SDK / API Client                           ││
│  └─────────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│                         OPENCODE SERVER                              │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │ /api/file/workspace/*  (new routes)                            │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                               │                                      │
│                               ▼                                      │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │ File Module (git operations)                                   │ │
│  │  └─ workspaceStatus()                                          │ │
│  │  └─ workspaceDiff()                                            │ │
│  │  └─ branchDiff()                                               │ │
│  │  └─ stage() / unstage()                                        │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                               │                                      │
│                               ▼                                      │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │ Agent System (for reviews)                                     │ │
│  │  └─ git-review agent                                           │ │
│  │  └─ SessionPrompt.prompt()                                     │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                               │                                      │
│                               ▼                                      │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │ Git CLI (via Bun $)                                            │ │
│  │  └─ git status, git diff, git add, git reset, etc.             │ │
│  └────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Data Models

### WorkspaceFileInfo

```typescript
type WorkspaceFileInfo = {
  path: string // Relative file path
  added: number // Lines added
  removed: number // Lines removed
  status: "added" | "deleted" | "modified" | "renamed" | "untracked"
  staged: boolean // Whether in staging area
  oldPath?: string // For renames, the original path
}
```

### WorkspaceStatus

```typescript
type WorkspaceStatus = {
  branch: string | null // Current branch name
  defaultBranch: string // Detected default branch (main/master)
  staged: WorkspaceFileInfo[] // Files in staging area
  unstaged: WorkspaceFileInfo[] // Modified but not staged
  untracked: WorkspaceFileInfo[] // New files not tracked
}
```

### WorkspaceDiff

```typescript
type WorkspaceDiff = {
  file: string
  before: string // Content before changes
  after: string // Content after changes
  additions: number // Total lines added
  deletions: number // Total lines removed
  status: "added" | "deleted" | "modified"
}
```

### BranchInfo

```typescript
type BranchInfo = {
  name: string
  current: boolean // Is this the checked-out branch?
  remote: boolean // Is this a remote-tracking branch?
  upstream?: string // e.g., "origin/main" for tracking branches
}
```

### ReviewResult

```typescript
type ReviewResult = {
  sessionId: string // Session where review ran
  timestamp: number // When review completed
  scope: "staged" | "unstaged" | "branch"
  summary: string // Overall assessment
  stats: {
    errors: number
    warnings: number
    suggestions: number
    ok: number
  }
  files: ReviewFileResult[]
}

type ReviewFileResult = {
  path: string
  status: "ok" | "info" | "warning" | "error" // Worst severity in file
  findings: ReviewFinding[]
}

type ReviewFinding = {
  line?: number // Line number if applicable
  endLine?: number // End line for ranges
  severity: "error" | "warning" | "info"
  category: "bug" | "security" | "performance" | "style" | "logic"
  message: string // What the issue is
  suggestion?: string // How to fix it
  code?: string // Relevant code snippet
}
```

---

## API Specification

### GET /api/file/workspace/status

Get current git status for the workspace.

**Response:**

```json
{
  "branch": "feature/my-branch",
  "defaultBranch": "main",
  "staged": [{ "path": "src/file.ts", "added": 10, "removed": 2, "status": "modified", "staged": true }],
  "unstaged": [{ "path": "src/other.ts", "added": 5, "removed": 0, "status": "modified", "staged": false }],
  "untracked": [{ "path": "src/new.ts", "added": 20, "removed": 0, "status": "untracked", "staged": false }]
}
```

### GET /api/file/workspace/diff

Get full diffs for specified scope.

**Query Parameters:**

- `scope`: `"staged"` | `"unstaged"` | `"all"`

**Response:**

```json
[
  {
    "file": "src/file.ts",
    "before": "...",
    "after": "...",
    "additions": 10,
    "deletions": 2,
    "status": "modified"
  }
]
```

### GET /api/file/workspace/branch-diff

Get diff between current HEAD and a base branch.

**Query Parameters:**

- `base`: Branch name to compare against (e.g., `"main"`)

**Response:** Same as `/workspace/diff`

### GET /api/file/workspace/branches

List all branches.

**Response:**

```json
[
  { "name": "main", "current": false, "remote": false },
  { "name": "feature/my-branch", "current": true, "remote": false },
  { "name": "origin/main", "current": false, "remote": true }
]
```

### GET /api/file/workspace/default-branch

Get the detected default branch.

**Response:**

```json
{ "branch": "main" }
```

### POST /api/file/workspace/stage

Stage specified files.

**Request:**

```json
{ "files": ["src/file.ts", "src/other.ts"] }
```

**Response:**

```json
{ "success": true }
```

### POST /api/file/workspace/unstage

Unstage specified files.

**Request:**

```json
{ "files": ["src/file.ts"] }
```

**Response:**

```json
{ "success": true }
```

### POST /api/file/workspace/stage-all

Stage all changes.

**Response:**

```json
{ "success": true }
```

### POST /api/file/workspace/unstage-all

Unstage all changes.

**Response:**

```json
{ "success": true }
```

### POST /api/file/workspace/discard

Discard changes in specified files.

**Request:**

```json
{ "files": ["src/file.ts"] }
```

**Response:**

```json
{ "success": true }
```

### POST /api/file/workspace/review

Start an AI review of changes.

**Request:**

```json
{
  "scope": "staged" | "unstaged" | "branch",
  "baseBranch": "main",           // Only for scope="branch"
  "files": ["src/file.ts"]        // Optional: specific files only
}
```

**Response:**

```json
{
  "sessionId": "ses_abc123" // Session ID to poll for results
}
```

### GET /api/file/workspace/review/:sessionId

Get review results (poll until complete).

**Response:**

```json
{
  "status": "running" | "complete" | "error",
  "result": { ... }               // ReviewResult when complete
}
```

---

## File Changes Summary

### Backend (packages/opencode)

| File                        | Change Type | Description                             |
| --------------------------- | ----------- | --------------------------------------- |
| `src/file/index.ts`         | Modify      | Add workspace git functions and schemas |
| `src/server/routes/file.ts` | Modify      | Add workspace API routes                |
| `src/agent/agent.ts`        | Modify      | Add `git-review` agent definition       |

### SDK (packages/sdk)

| File                 | Change Type | Description          |
| -------------------- | ----------- | -------------------- |
| `js/script/build.ts` | Run         | Regenerate SDK types |

### Frontend (packages/claxedo-app)

| File                                                | Change Type | Description                             |
| --------------------------------------------------- | ----------- | --------------------------------------- |
| `src/claxedo-ui/context/claxedo-layout.tsx`         | Modify      | Add `"git"` tab type, `addGit()` method |
| `src/claxedo-ui/layouts/top-tab-bar.tsx`            | Modify      | Add Git button                          |
| `src/claxedo-ui/components/tab-content-area.tsx`    | Modify      | Add git tab host                        |
| `src/claxedo-ui/components/tab-portal.tsx`          | Modify      | Portal git content                      |
| `src/claxedo-ui/components/tab-git.tsx`             | Create      | Main Git panel component                |
| `src/claxedo-ui/components/git-file-list.tsx`       | Create      | File list component                     |
| `src/claxedo-ui/components/git-branch-selector.tsx` | Create      | Branch dropdown                         |
| `src/claxedo-ui/components/git-review-results.tsx`  | Create      | Review results panel                    |
| `src/context/workspace.tsx`                         | Create      | Workspace state provider                |

### Shared UI (packages/ui) - Optional

| File                      | Change Type | Description                     |
| ------------------------- | ----------- | ------------------------------- |
| `src/components/icon.tsx` | Modify      | Add git-related icons if needed |

---

## Implementation Phases

### Phase 1: Backend Foundation

**Estimated: 2-3 hours**

1. Add Zod schemas for workspace types
2. Implement git command wrappers:
   - `workspaceStatus()` - parse `git status --porcelain`
   - `stage(files)` - run `git add`
   - `unstage(files)` - run `git reset HEAD`
   - `discardChanges(files)` - run `git checkout --`
   - `listBranches()` - parse `git branch -a`
   - `getDefaultBranch()` - check remote HEAD or common names
3. Implement diff functions:
   - `workspaceDiff(scope)` - get staged/unstaged diffs
   - `branchDiff(base)` - compare to branch
4. Add API routes

### Phase 2: SDK & Types

**Estimated: 15 minutes**

1. Run SDK build script
2. Verify generated types match expectations

### Phase 3: AI Review Agent

**Estimated: 1-2 hours**

1. Create review prompt template
2. Add `git-review` agent definition
3. Implement review endpoint that:
   - Gathers diffs for scope
   - Creates session with review agent
   - Returns session ID for polling
4. Add result parsing for structured output

### Phase 4: Tab Infrastructure

**Estimated: 1-2 hours**

1. Extend `TabType` to include `"git"`
2. Add `addGit()` method to `topTabs`
3. Add Git button to top tab bar
4. Add tab content host in `tab-content-area.tsx`
5. Add portal rendering in `tab-portal.tsx`

### Phase 5: Git Panel UI

**Estimated: 3-4 hours**

1. Create `WorkspaceProvider` context
2. Create `TabGit` main component
3. Create `GitFileList` with:
   - Checkbox selection
   - Status icons
   - Action buttons (stage/unstage/discard)
   - Line count display
4. Create `GitBranchSelector` dropdown
5. Implement tab switching (Unstaged/Staged/Branch)
6. Wire up all actions to API

### Phase 6: Review UI

**Estimated: 2-3 hours**

1. Create `GitReviewResults` component
2. Implement review button with loading state
3. Poll for review completion
4. Display results with collapsible file sections
5. Show severity icons and line references

### Phase 7: Polish & Testing

**Estimated: 2-3 hours**

1. Error handling and edge cases
2. Loading states and skeletons
3. Empty states
4. Keyboard shortcuts (optional)
5. Integration testing

---

## Error Handling

### Git Errors

| Scenario                     | Handling                                               |
| ---------------------------- | ------------------------------------------------------ |
| Not a git repository         | Show message: "This workspace is not a git repository" |
| Git not installed            | Show message: "Git is not installed"                   |
| Uncommitted merge conflict   | Show warning, disable certain actions                  |
| Detached HEAD                | Show branch as "(detached)"                            |
| File doesn't exist (discard) | Skip silently, refresh status                          |
| Permission denied            | Show error toast                                       |

### Network Errors

| Scenario            | Handling                          |
| ------------------- | --------------------------------- |
| API request fails   | Show toast with retry button      |
| Timeout             | Show timeout message, allow retry |
| Server disconnected | Show reconnecting state           |

### Review Errors

| Scenario              | Handling                       |
| --------------------- | ------------------------------ |
| No files to review    | Disable button, show tooltip   |
| Review fails          | Show error in review panel     |
| Malformed AI response | Show raw response with warning |
| Rate limited          | Show "Try again later" message |

---

## Edge Cases

1. **Very large diffs**: Truncate preview, show "N more lines"
2. **Binary files**: Show "(binary)" instead of diff
3. **Empty repository**: Show "No commits yet" state
4. **Submodules**: Show as single entry or skip
5. **Renamed files**: Show old → new path
6. **Symlinks**: Handle or skip gracefully
7. **Files outside repo**: Should not appear
8. **Concurrent edits**: Refresh resolves conflicts
9. **Review while agent running**: Disable button or queue

---

## Future Enhancements (Out of Scope for v1)

1. **Inline diff viewer**: Click file to see side-by-side diff in panel
2. **Commit creation**: Create commits from the UI
3. **Stash support**: View and apply stashes
4. **Cherry-pick review findings**: Apply AI suggestions automatically
5. **Review history**: View past reviews
6. **Custom review rules**: User-defined patterns to check
7. **Integration with PR workflow**: Push and create PR
8. **Keyboard shortcuts**: `g` to open git panel, `s` to stage, etc.

---

## Open Questions

1. **Icon**: Use existing `branch` icon or add custom git icon?
2. **Diff preview**: Should clicking a file show a diff preview inline?
3. **Review persistence**: Store review results across tab close?
4. **Auto-refresh**: Poll for changes or manual refresh only?
5. **Untracked files**: Include in "Unstaged" or separate section?

---

## Success Metrics

1. **Adoption**: % of sessions that open Git panel
2. **Engagement**: Average actions per Git panel session
3. **Review usage**: % of commits preceded by AI review
4. **Issue detection**: Bugs found by review before commit

---

## References

- Existing `/review` command: `packages/opencode/src/command/template/review.txt`
- File.status() implementation: `packages/opencode/src/file/index.ts:353-425`
- Tab system: `packages/claxedo-app/src/claxedo-ui/context/claxedo-layout.tsx`
- Agent definitions: `packages/opencode/src/agent/agent.ts`
