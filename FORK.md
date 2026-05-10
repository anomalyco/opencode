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

### 6. `/recent` Route and Navigation

**Files:**
- `packages/app/src/app.tsx` — lazy `RecentRoute` import and `/recent` route (MUST be before `/:dir` catch-all)
- `packages/app/src/pages/layout.tsx` — `RecentTile` onClick calls `navigate("/recent")`
- `packages/app/src/pages/layout/sidebar-recent.tsx` — slug uses `base64Encode(session.directory)` (NOT hardcoded `"recent"`)
- `packages/app/src/pages/layout/sidebar-items.tsx` — message hover navigate uses absolute path with leading `/`

**How to verify:**
1. Click "Recent sessions" tile on home page → URL changes to `/recent`, main content shows "Recently Active" page
2. Click any session in the recent sidebar → URL is `/<base64dir>/session/<sessionId>`, session content loads
3. Hover a session → hover preview shows messages; clicking a message navigates to the correct session

### 7. Session Auto-Title and Rename

**Files:**
- `packages/opencode/src/session/prompt.ts` — `ensureTitle()` at line ~170, called on step 1 (first assistant response)
- `packages/opencode/src/agent/agent.ts` — built-in "title" agent definition (line ~261)
- `packages/opencode/src/agent/prompt/title.txt` — title generation system prompt
- `packages/app/src/pages/session/message-timeline.tsx` — `titleMutation`, `openTitleEditor()`, "Rename" dropdown item

**How to verify:**
1. Send a message in a new session → after first assistant response, session title should auto-update from "New session - ..." to a generated title
2. Open "More options" dropdown on a session → "Rename" item appears → clicking opens inline title editor
3. If auto-title fails, check that the configured provider has a working "small" model available

### 8. TTS (Text-to-Speech) Support

**Files:**
- `packages/opencode/src/server/routes/tts.ts` — TTS HTTP endpoint

**How to verify:** Check that the TTS route exists and responds (GET/POST to `/tts/...`).

### 9. Auto-Resume on Serve

**Files:**
- `packages/opencode/src/cli/cmd/serve.ts` — `autoresume()` function dedupes sessions and resumes by recency

**How to verify:** Start `opencode serve`, sessions with pending questions should auto-resume.

### 10. Multi-Instance Serve

**Files:**
- `packages/opencode/src/cli/cmd/serve.ts` — `OPENCODE_INSTANCE_MAX` env var support

**How to verify:** Env var `OPENCODE_INSTANCE_MAX=16` is respected in systemd service config.

---

## 🧪 Post-Rebase Browser Smoke Test

After every rebase + deploy, run through this checklist in the browser:

| # | Test | Expected |
|---|------|----------|
| 1 | Navigate to `/` | Home page loads with "Recent projects" tiles |
| 2 | Click "Recent sessions" tile | URL → `/recent`, main content shows "Recently Active" with session list |
| 3 | Click "Recent sessions" sidebar button | Sidebar switches to recent sessions panel |
| 4 | Click a session in recent sidebar | URL → `/<base64dir>/session/<id>`, session messages load |
| 5 | Click a project tile on home page | Project's session list loads, sidebar shows project sessions |
| 6 | Open model picker (model button) | "Recently Used" group appears at top |
| 7 | Hover a session in sidebar | Preview card shows user messages |
| 8 | Check parent/child sessions | Subagent sessions nested under parent with collapse chevron |
| 9 | Check session labels in recent sidebar | Project/workspace labels shown under session titles |
| 10 | Open "More options" on a session | "Rename" option present; clicking opens inline editor |
| 11 | Send a message in new session | After first response, title auto-updates from "New session - ..." |
| 12 | Verify back/forward navigation | Browser back/forward buttons work between sessions |

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

# 4. Walk through features 1–9 above and verify each one in the code
# 5. Run typecheck
cd packages/opencode && bun typecheck

# 6. Build and deploy
cd packages/opencode && bun run build
# Copy binary to ~/.local/bin/opencode on the remote
# Restart service: systemctl --user restart opencode-serve

# 7. Run the Browser Smoke Test (10-item checklist above) on the deployed instance
```

## Deployment Quick Reference

```bash
# On remote VM (azureuser@100.108.64.76):
export PATH=$HOME/.local/bin:$HOME/.bun/bin:$PATH
cd /home/azureuser/workspace/opencode-deploy-159-OhZXeN
git pull origin dev
cd packages/opencode && bun run build
# Stop service, copy binary, restart:
systemctl --user stop opencode-serve
cp dist/opencode-linux-x64/bin/opencode ~/.local/bin/opencode
systemctl --user start opencode-serve
```
