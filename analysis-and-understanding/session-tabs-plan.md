# Plan: Chrome-style Session Tabs (replaces left sidebar)

## Recommended desktop target

**Both `desktop` (Tauri) and `desktop-electron` share the same UI** — it lives in `packages/app` and is mounted from both shells. All UI changes below land once in `packages/app` and work on both targets automatically. Only the shell code (e.g. `titleBarOverlay` color) might need a touch-up because the titlebar gets taller; those are small, symmetric tweaks in each shell.

## User-selected scope

- **Auto** — all sessions in an open project are tabs (no new open/close state model)
- **Global** — one tab bar across all open projects; colored/grouped by project
- **Remove the entire sidebar** — project switching migrates into a dropdown/menu in the tab bar

## Architecture today (what we're replacing)

Currently, sessions are rendered in the left sidebar, owned by `packages/app/src/pages/layout.tsx` (≈2 500 lines). The relevant pieces:

- **Project rail** (64 px, always visible): `pages/layout/sidebar-shell.tsx` + `sidebar-project.tsx`. Clicking a project icon switches project; right-click = project menu.
- **Session panel** (resizable, 244–~30vw): rendered inside the rail host by `SidebarPanel` (inline in `layout.tsx` at ≈L2024) and delegated to `pages/layout/sidebar-workspace.tsx` (which renders `NewSessionItem`, `SessionItem`, `SessionSkeleton`). Shown only for the *currently selected* project.
- **Titlebar** (40 px, drag region, mounts center/right Portals used by `SessionHeader`): `components/titlebar.tsx`.
- **State**: `context/layout.tsx` — `sidebar.{opened,width,workspaces,workspacesDefault}`, `mobileSidebar`, plus project list in `LayoutContext.projects`.
- **Routing**: `/:dir/session/:id?` in `app.tsx`. URL is the source of truth for the active session; there's no existing "open tabs" concept for sessions (there is one for files, which we'll mirror).
- **Prefetch/warm logic** (≈500 LOC inside `layout.tsx`): prefetches N sessions around the active one in each visible workspace. This currently piggybacks on "visible session dirs" derived from the sidebar; we'll need to keep it alive using the tab-bar projection instead.
- **Notifications, unseen counts, permissions, archive, drag-to-reorder, inline rename, hover-preview, peek panel, sort bumping, AIM triangle, keybinds (`alt+↑/↓`, `mod+alt+↑/↓`), deep links** — all live in the sidebar paths and must be re-homed on the tab bar.

## Target architecture

```
┌───────────────────────────────────────────────────────────────────────┐
│  Titlebar row (shrunk, keeps drag region + window controls + ⌘search) │
├───────────────────────────────────────────────────────────────────────┤
│  TAB BAR  [ProjectMenu▼] [tab][tab][tab*][+]     [overflow▼][settings]│
├───────────────────────────────────────────────────────────────────────┤
│                                                                       │
│                          Active session view                          │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
```

- One horizontal tab strip, always visible on desktop (hidden on `xl:hidden` → mobile keeps existing drawer).
- Tabs are grouped/colored by project (left color stripe + project icon, matching Chrome's tab-group look).
- A **Project menu** (`[ProjectMenu▼]`) on the far-left replaces the project rail: list open projects, open-project action, recent projects, settings, help.
- **Overflow menu** on the right holds tabs that don't fit (Chrome-style). Horizontally scrolls + ⌘-wheel, plus keyboard navigation.
- **Settings/help** (today at the bottom of the rail) move to the right side of the tab bar.

## Files that need to change

### Core (new)

1. **`packages/app/src/components/session-tabs/session-tab-bar.tsx`** *(new, ≈300–400 LOC)*
   Top-level tab strip. Renders: project menu, sortable tab list (grouped by project), new-session button, overflow menu, settings cluster.

2. **`packages/app/src/components/session-tabs/session-tab.tsx`** *(new, ≈150 LOC)*
   Single tab: project-colored stripe, project icon, working spinner / unseen / permission dot, truncated title, inline rename on double-click, close (archive) button, middle-click-close, drag handle (reuses `@thisbeyond/solid-dnd`), context menu (archive, rename, duplicate, close-others, close-right…).

3. **`packages/app/src/components/session-tabs/session-tab-overflow.tsx`** *(new, ≈100 LOC)*
   Overflow dropdown using `IntersectionObserver` to detect which tabs are clipped (same trick as Chrome).

4. **`packages/app/src/components/session-tabs/project-switcher.tsx`** *(new, ≈150 LOC)*
   Replaces the project rail. Shows a project dropdown with: open projects, "open project" (⌘O), close project, project settings. Uses existing `ProjectIcon`, `chooseProject`, `openProject`, `closeProject` from `layout.tsx`.

5. **`packages/app/src/components/session-tabs/use-tab-model.ts`** *(new, ≈150 LOC)*
   Aggregates every open project's sessions into a single flat tab list (sorted by project order, then session `sortedRootSessions`). Wraps the prefetch/warm/LRU logic currently scattered in `layout.tsx` so we can reuse it with an "all sessions visible" input instead of "sessions in visible sidebar workspaces".

6. **`packages/app/src/components/session-tabs/session-tabs.css`** *(new)*
   Chrome-style tab shapes (trapezoid with rounded top corners via masks) + color-stripe per project. Can also extend `packages/ui/src/components/tabs.css` variant if we want to reuse Kobalte.

### Core (modify)

7. **`packages/app/src/pages/layout.tsx`** *(≈2 500 LOC, big surgery)*
   - Remove entirely: `SidebarPanel` (≈L2024–L2327), `sidebarContent` (≈L2331), the desktop `<nav data-component="sidebar-nav-desktop">` block (≈L2370), the `<ResizeHandle>` for sidebar width (≈L2395), the peek panel (≈L2469), the AIM triangle (`createAim`), `hoverProject` state, `peek`/`peeked` state, `navLeave`/`arm`/`disarm`, `sidebarHovering`/`sidebarExpanded`/`sidebarProject`/`peekProject` memos — all only exist to support hover-to-preview on the collapsed rail.
   - Keep and expose: `openProject`, `closeProject`, `chooseProject`, `navigateToProject`, `navigateToSession`, `navigateSessionByOffset`, `archiveSession`, `createWorkspace`, `renameProject`, `showEditProjectDialog`, `prefetchSession`, `warm`, `currentSessions`, the command registrations, the deep-link handler, SDK notification toasts, update polling. Factor these out of the `Layout` component into hooks (`use-project-actions`, `use-session-actions`, `use-prefetch`) or keep them in `Layout` but pass them down to the new tab bar via a context. This refactor is the bulk of the work.
   - `visibleSessionDirs` currently derives from "which workspaces are expanded in the sidebar". Replace with "every directory across every open project", because the tab bar shows them all.
   - Delete mobile-sidebar handling? **Keep it** — on `xl:hidden` the plan should still fall back to the current drawer-style list (tabs don't fit on phones). The tab bar is `hidden xl:flex`.
   - Update layout math: remove `--main-left: 4rem|side()px`, remove sidebar resize logic, adjust dialog-left-margin effect (L1808).

8. **`packages/app/src/components/titlebar.tsx`** *(≈320 LOC)*
   - Drop the sidebar-toggle button, the `ml-14`/`ml-2` web-vs-desktop offsets, and the new-session/back/forward nav cluster (these move into the tab bar). Keep: drag region, mac traffic-light spacer, Windows control spacer, `opencode-titlebar-{center,right}` portal mounts, mobile menu button.
   - Render `<SessionTabBar />` *beneath* the existing titlebar (as a second row) so the Tauri drag region / mac traffic lights stay functional. Alternative: inline the tab bar into the titlebar row and give it `-webkit-app-region: no-drag` — simpler visually but harder on Windows with `titleBarOverlay`. Recommend separate rows.

9. **`packages/app/src/context/layout.tsx`** *(≈950 LOC)*
   - Deprecate: `sidebar.opened`, `sidebar.width`, `sidebar.workspaces`, `sidebar.workspacesDefault`, `sidebar.toggle/open/close/resize/toggleWorkspaces`, `mobileSidebar` (keep for mobile), all the migration code for v1→v6 sidebar. We need a **migration step (`layout.v7`)** that drops these fields gracefully so existing users don't crash on load.
   - Keep: `projects`, `terminal`, `review`, `fileTree`, `session.width`, `sessionTabs` (file tabs inside a session — unrelated), `sessionView`, `handoff`. The `projects` state is reused as-is.
   - `keybind('sidebar.toggle')` (`⌘B`) consumers exist; either remove the command or repurpose (e.g. toggle project menu).

10. **`packages/app/src/pages/layout/sidebar-*.tsx`** *(4 files, ~1 500 LOC combined)*
    - **Delete**: `sidebar-shell.tsx`, `sidebar-workspace.tsx`, `sidebar-project.tsx`.
    - **Keep and move**: `sidebar-items.tsx` exports `ProjectIcon` (reused in `project-switcher.tsx` and `session-tab.tsx`) and the `SessionItem` logic (unseen dot, working spinner, tint, permission pulse) — extract a small `SessionTabIndicator` from this file. Keep `childSessionOnPath` / `sortedRootSessions` (`helpers.ts`) — they're reused.
    - `inline-editor.tsx` (rename helper) moves to `components/` since both project menu and tab bar need inline rename.

11. **`packages/app/src/components/session/session-header.tsx`** *(503 LOC)*
    - The title bar's `center` Portal still renders the file search (keep it).
    - The `right` Portal still renders openPath + terminal + review + file-tree toggles (keep).
    - No functional change, but visual spacing might need a tweak since the titlebar is shorter when the sidebar-toggle button is gone.

12. **`packages/app/src/app.tsx`** *(≈314 LOC)*
    - Routing stays identical. `AppShellProviders` stays. No changes unless we choose to move prefetch logic into a provider.

### Peripheral (modify, small)

13. **`packages/app/src/components/session/session-sortable-tab.tsx` & `pages/session/file-tabs.tsx`**
    No changes. These are *file* tabs inside a session. They'll continue to work exactly the same — they live below the new session tab bar.

14. **`packages/app/src/components/debug-bar.tsx`, `status-popover.tsx`**
    No changes.

15. **`packages/app/src/pages/layout/deep-links.ts`, `pages/session/handoff.ts`**
    No changes. Deep links already dispatch through `openProject` / `setSessionHandoff` which survive.

16. **Shell code** *(small)*
    - `packages/desktop-electron/src/main/windows.ts`: `titleBarOverlay` height implicitly depends on CSS; if we make the tab bar row its own element (recommended), the overlay stays 40 px and we're fine. Verify the `titleBarOverlay` color still matches on Windows.
    - `packages/desktop/src-tauri/tauri.conf.json`: `titleBarStyle: Overlay` on macOS already works with a row beneath. No config change expected.

17. **i18n**
    - New keys in `packages/app/src/i18n/` (and each locale): `sessionTab.close`, `sessionTab.closeOthers`, `sessionTab.closeRight`, `sessionTab.archive`, `sessionTab.rename`, `sessionTab.overflow`, `projectMenu.open`, `projectMenu.switch`, `projectMenu.close`. Roughly 10–15 new strings × ~20 locales. Follow existing patterns.

### Tests

18. **New**
    - `components/session-tabs/session-tab-bar.test.ts` — mount with mocked layout ctx; verify tab order, overflow detection, close → archive path.
    - `components/session-tabs/use-tab-model.test.ts` — flat-list aggregation across projects, sort stability, LRU prefetch budget.
    - `components/session-tabs/project-switcher.test.ts` — project open/close/switch menu.
19. **Update**
    - `pages/layout/helpers.test.ts` — unchanged if helpers stay, but tests that reference removed `effectiveWorkspaceOrder` callers will need updating.
    - `components/titlebar-history.test.ts` — unchanged; history tracking still works.
    - `components/session/titlebar-history.test.ts` — unchanged.
    - e2e in `packages/app/e2e/` (if any exist for sidebar) — update.
20. **Delete**
    - Any sidebar-specific stories/tests (check `packages/storybook`).

## Behaviour decisions (sign off before code starts)

| Topic | Proposed |
|---|---|
| Tab order | Sorted by `sortedRootSessions` within each project (most recent first). Re-orderable via drag within a project's group only. Cross-project drag reorders the project in the project list. |
| Tab colouring | `ProjectIcon` colour (`getAvatarColors`) as a 2-pixel top-border on the tab; project icon small, on the left of the tab. |
| Tab close button | X on hover, middle-click, `⌘W`. Close = archive session (today's behaviour of `archiveSession`). |
| Unseen dot | Keep exact semantics from `SessionRow` (`messageAgentColor`, spinner, warning pulse). |
| Max tabs visible | Shrink min-width 120 → 32 px (Chrome does ~32 when full). Below that, overflow. |
| Archived sessions | Not shown in tabs. "Recently archived" stays reachable via an overflow sub-menu. |
| Tab reordering persistence | Reuse `workspaceOrder` pattern in layout persisted store. |
| Keybinds | `⌘T` new session in current project, `⌘W` close, `⌘shift+T` reopen last archived, `⌘1..9` jump to tab (new), `⌘⇥`/`⌘⇧⇥` next/prev tab. Migrate `session.previous/next` from `alt+↑/↓` to `⌘⇥` (plus keep legacy). |
| Mobile (`<xl`) | Unchanged — current drawer-style mobile sidebar remains. |
| Web deployment | Same tab bar; just sits on top row (no custom titlebar). |

## Work breakdown & effort estimate

Assuming one engineer familiar with the codebase, using the existing Tailwind / solid-dnd / Kobalte primitives:

| # | Task | Est. |
|---|---|---|
| 1 | Refactor `layout.tsx`: extract `use-project-actions`, `use-session-actions`, `use-prefetch` hooks; move the 500+ LOC of prefetch/queue logic out of the component; add a small `LayoutContext` API surface for the tab bar | **2–3 days** |
| 2 | Build `use-tab-model.ts` (flat cross-project tab list, sort, persist order) + tests | **1 day** |
| 3 | Build `session-tab.tsx` with states (working/unseen/permission), inline rename, context menu, drag-sortable, middle-click | **1.5 days** |
| 4 | Build `session-tab-bar.tsx` with horizontal scroll, overflow detection, DnD provider, keyboard nav, new-session button | **1.5 days** |
| 5 | Build `project-switcher.tsx` + move settings/help buttons onto the tab bar | **1 day** |
| 6 | Tab styling CSS (Chrome trapezoid, group colour, dark-mode) | **1 day** |
| 7 | Rip out sidebar from `layout.tsx` and `titlebar.tsx`; wire in `SessionTabBar`; delete 3 sidebar files | **1 day** |
| 8 | `layout.v7` persist migration; drop sidebar fields; keep `sessionTabs` (file) intact | **0.5 day** |
| 9 | i18n keys in all ~24 locales | **0.5 day** |
| 10 | Desktop shell verification (Electron Windows overlay colour, macOS traffic-light spacing in both shells, keybind OS parity) | **0.5 day** |
| 11 | Tests (unit + e2e smoke) and visual QA on macOS / Windows / Linux / web | **1–2 days** |
| 12 | Edge cases: deep links while tabs exist, worktree creation/reset flows, notification toasts with no sidebar, permission pulses, empty-state when 0 projects open, session archive+navigate | **1 day** |

**Total: ~11–13 working days (~2.5 weeks)** for a polished v1. A quick-and-dirty "tabs at top but sidebar still there" prototype can be done in ~3 days.

## Risks / things that bite

1. **Hover-preview affordance**: today clicking a project icon switches project, hovering shows a recent-sessions preview card. Removing the rail removes this gesture. Users who have many projects will need an equally fast way to switch. Solution: the project dropdown surfaces the last-used session per project (already tracked in `lastProjectSession`).
2. **Horizontal screen budget**: 10+ sessions across 3 projects = ~30 tabs. Overflow menu is mandatory, not optional.
3. **Drag-drop cross-file-tabs clash**: the file-tab bar (inside a session) also uses `@thisbeyond/solid-dnd` — make sure the two DnD providers don't interfere (they're nested, should be fine; they already are today).
4. **Prefetch LRU sizing**: today `PREFETCH_MAX_SESSIONS_PER_DIR = 10` assumes a single visible workspace. With a global tab bar, bump the overall budget but keep per-project LRU; otherwise a user with many projects thrashes the cache.
5. **Route ↔ tab-bar divergence**: the URL is still the source of truth for the active session. If a user navigates via history/back-forward or deep link to an archived session, the tab bar must materialise a transient tab for it or redirect. Spec this before coding.
6. **Persistence migration**: if a user drops back to an older app build after the v7 migration, the sidebar state is gone. This is one-way; worth documenting in the release notes.

## Minimal first-pass alternative (1–2 days)

If you want to validate the UX cheap before committing:
- Add a new `SessionTabBar` component that renders under `Titlebar` but **don't delete the sidebar**.
- Wire it to the same `currentSessions` memo that drives the sidebar (current project only).
- Hide the sidebar behind a settings toggle (`settings.general.sessionTabs`).

That lets you ship to internal testers in days, see how it feels with real session counts, and then commit to the full refactor.
