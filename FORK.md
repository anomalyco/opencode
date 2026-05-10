# Fork-Specific Features (dzianisv/opencode)

This document tracks custom features added to this fork that are **not present upstream**.
Use this as a checklist after every rebase on `upstream/dev` to verify nothing was lost.

---

## ⚠️ Rebase Survival Checklist

After rebasing on `upstream/dev`, verify each feature still works:

### 1. Recently Used Models in Model Picker

**Files:** `packages/app/src/components/dialog-select-model.tsx`

- The model picker dialog shows a **"Recently Used"** group at the top
- Recent models are sourced from `model.recent?.()` in the models context
- Each model item has a `_group` ("recent" | "provider") and discriminated `_key` to avoid duplicate key conflicts
- The "Recently Used" group is always pinned first via `sortGroupsBy`

**How to verify:** Open model picker (Cmd+M or the model button) → you should see "Recently Used" group at the top with previously used models.

### 2. Project Labels in Recent Sessions Sidebar

**Files:**
- `packages/app/src/pages/layout/sidebar-items.tsx` — `SessionRow` renders `prefix` label under session title
- `packages/app/src/pages/layout/sidebar-recent.tsx` — passes `prefixes` from `organizeRecentSessions()` to `SessionItem`
- `packages/app/src/utils/recent-session.ts` — `organizeRecentSessions()` computes prefix map

**How to verify:** Open the recent sessions sidebar → sessions from different projects should show the project/workspace name as a small label under the session title.

### 3. Collapsible Parent/Child Session Tree

**Files:**
- `packages/app/src/pages/layout/sidebar-items.tsx` — `SessionItem` renders child sessions recursively with depth-based indentation and collapse/expand chevron toggle
- `packages/app/src/pages/layout/sidebar-recent.tsx` — passes `children` map to `SessionItem`
- `packages/app/src/pages/layout/sidebar-project.tsx` — passes `children` map via `childMapByParent()`
- `packages/app/src/pages/layout/sidebar-workspace.tsx` — passes `children` map via `childMapByParent()`
- `packages/app/src/pages/layout/helpers.ts` — `childMapByParent()` builds parent→child ID map

**How to verify:** Sessions with subagents should show nested under their parent with a collapse chevron. Clicking the chevron folds/unfolds children.

### 4. Session Hover Preview (HoverCard with Messages)

**Files:**
- `packages/app/src/pages/layout/sidebar-items.tsx` — `SessionHoverPreview` component wraps `SessionRow` in a `HoverCard` showing user messages via `MessageNav`

**How to verify:** Hover over a session in the sidebar for ~1 second → a preview card should appear showing the session's user messages.

### 5. workspaceKey Helper (replaces pathKey)

**Files:**
- `packages/app/src/pages/layout/helpers.ts` — `workspaceKey()` normalizes workspace directory paths (handles Windows paths, trailing slashes, drive letters)
- Used in `sidebar-workspace.tsx` and `helpers.ts` instead of `pathKey` from `@/utils/path-key`

---

## Common Rebase Conflict Zones

These files are frequently modified by both upstream and this fork. Pay extra attention:

| File | Risk | What to watch for |
|------|------|-------------------|
| `sidebar-items.tsx` | **HIGH** | `SessionItemProps` type, `SessionRow`, `SessionItem`, `SessionHoverPreview` |
| `sidebar-recent.tsx` | **HIGH** | Props passed to `SessionItem` (children, lookup, prefixes, popover) |
| `sidebar-project.tsx` | MEDIUM | `childMapByParent` usage, `sessionProps` Omit type, `setHoverSession` |
| `sidebar-workspace.tsx` | MEDIUM | `childMapByParent` usage, `workspaceKey` import, removed `useIsFetching` |
| `helpers.ts` | MEDIUM | `childMapByParent()`, `workspaceKey()` functions |
| `dialog-select-model.tsx` | LOW | Recently used models grouping logic |

## Import Path Differences

Upstream uses `@opencode-ai/core/util/encode` and `@opencode-ai/core/util/path`.
If upstream ever renames these, update all sidebar files accordingly.

## API Path Note

The global session API is at `client.experimental.session` (upstream renamed from `client.global.session`).
If this changes upstream, update `sidebar-recent.tsx`.

---

## How to Rebase Safely

```bash
# 1. Create a backup branch BEFORE rebasing
git branch backup/dev-$(date +%Y%m%d%H%M%S)

# 2. Rebase
git rebase upstream/dev

# 3. After resolving conflicts, diff against backup to check for lost features
git diff HEAD..backup/dev-YYYYMMDDHHMMSS -- packages/app/src/pages/layout/

# 4. Walk through this checklist and verify each feature
# 5. Run typecheck
cd packages/app && bun typecheck
```
