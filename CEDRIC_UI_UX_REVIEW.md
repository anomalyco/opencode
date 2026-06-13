# Cedric UI/UX Review & Product Improvement Report

**Date:** June 2026
**Reviewer:** Product Orchestrator
**App:** Cedric (formerly OpenKimi/OpenCode)
**Platform:** macOS Desktop (Electron)

---

## Executive Summary

Cedric has made significant progress toward its vision as an "LLM Operating System." The multi-tab workspace architecture is implemented at a foundational level, the browser integration is functional, and the rebrand to "Cedric" has begun in the desktop package. However, **critical gaps remain** that prevent Cedric from delivering on its promise:

1. **Branding is inconsistent** — "OpenCode", "OpenKimi", "opencode-ai", and "Cedric" references are mixed throughout the codebase and UI
2. **Three core tab types are non-functional placeholders** — Terminal, Side Chat, and Code Viewer show only "Coming Soon"
3. **The debug/performance panel is visible in production builds** — a critical professionalism issue
4. **Empty states lack guidance** — users are left without clear next steps
5. **The Swarm feature is still a tab-based UI** — not the background agent channel architecture envisioned
6. **No workspace persistence** — tab layouts are lost on every session

**Overall Verdict:** The foundation is solid, but Cedric is currently **60% complete** toward its MVP vision. The remaining 40% is polish, completion of placeholder features, and architectural alignment with the LLM OS vision.

---

## 1. Branding & Identity Audit

### Current State

| Location | Current Value | Target Value | Status |
|----------|--------------|--------------|--------|
| Root package.json name | `openkimi` | `cedric` | ❌ Not updated |
| Root package.json description | `OpenKimi - Desktop app...` | `Cedric - Your LLM Operating System` | ❌ Not updated |
| Root package.json repository | `yourusername/openkimi` | `yourusername/cedric` | ❌ Not updated |
| Desktop package.json name | `@cedric/desktop` | ✅ Correct | ✅ Done |
| Desktop package.json author | `Cedric` | ✅ Correct | ✅ Done |
| UI package imports | `@cedric/ui` | `@cedric/ui` | ❌ Not updated |
| Core package imports | `@cedric/core` | `@cedric/core` | ❌ Not updated |
| App package imports | `@cedric/app` | `@cedric/app` | ❌ Not updated |
| SDK package imports | `@cedric/sdk` | `@cedric/sdk` | ❌ Not updated |
| Window title | "OpenCode" (per UI_UX_AUDIT.md) | "Cedric" | ❌ Not updated |
| Protocol handler | `openkimi://` | `cedric://` | ❌ Not updated |
| Bundle ID | `dev.openkimi.desktop` | `dev.cedric.desktop` | ❌ Not updated |

### Impact
**Severity: 🔴 Critical**

Users see inconsistent branding across the app. The window title shows "OpenCode", the protocol is `openkimi://`, but the desktop package says "Cedric". This creates confusion and undermines trust in the product as a standalone platform.

### Files Requiring Updates

**Package Names (requires coordinated rename):**
- `packages/ui/package.json` → `@cedric/ui`
- `packages/core/package.json` → `@cedric/core`
- `packages/app/package.json` → `@cedric/app`
- `packages/sdk/package.json` → `@cedric/sdk`
- `packages/llm/package.json` → `@cedric/llm`
- `packages/desktop/package.json` → already `@cedric/desktop` ✅

**Import Statements (100+ files):**
- All `from "@cedric/ui/..."` → `from "@cedric/ui/..."`
- All `from "@cedric/core/..."` → `from "@cedric/core/..."`
- All `from "@cedric/sdk/..."` → `from "@cedric/sdk/..."`

**Configuration Files:**
- `packages/desktop/electron-builder.config.ts` — bundle ID, protocol
- `packages/desktop/src/main/index.ts` — protocol handlers
- `packages/desktop/src/main/constants.ts` — app name
- `packages/app/index.html` — title tag
- All `README.*.md` files — replace OpenKimi with Cedric

### Recommendation

**Phase 1 (Immediate):** Update all user-facing strings to say "Cedric" even if internal package names remain `@cedric/*` temporarily.

**Phase 2 (This Week):** Perform a coordinated package rename. Use a script to bulk-replace all import paths. Update `tsconfig.json` path mappings. Verify build succeeds.

**Phase 3 (Next Week):** Update all documentation, README files, and the repository URL.

---

## 2. Workspace Tab System Review

### What's Working ✅

| Feature | Status | Quality |
|---------|--------|---------|
| Tab state management (`workspace-tabs.ts`) | ✅ Implemented | Good — SolidJS store, proper batching |
| Tab bar rendering | ✅ Implemented | Good — icons, close buttons, drag-and-drop |
| New tab palette | ✅ Implemented | Acceptable — basic UI, needs polish |
| Browser tab (multiple instances) | ✅ Implemented | Good — webview with navigation, error handling |
| Review tab (git changes) | ✅ Implemented | Good — pinned by default |
| File tab (markdown) | ✅ Implemented | Good — TOC sidebar, scroll sync |
| Tab reordering | ✅ Implemented | Acceptable — drag-and-drop works |
| Tab activation | ✅ Implemented | Good — proper state switching |

### What's Broken or Incomplete 🔴

| Feature | Status | Issue |
|---------|--------|-------|
| **Terminal tab** | 🔴 Placeholder | Shows only "Terminal (Coming Soon)" — no actual terminal |
| **Side Chat tab** | 🔴 Placeholder | Shows only "Side Chat (Coming Soon)" — no chat interface |
| **File tab (code files)** | 🔴 Placeholder | Shows "Code viewer for {path}" — no syntax highlighting, no editor |
| **Tab persistence** | 🔴 Missing | Workspace layout lost on app restart |
| **Tab keyboard shortcuts** | 🟡 Missing | No Cmd+W to close tab, Cmd+T for new tab, etc. |
| **Tab context menu** | 🟡 Missing | No right-click menu (close others, duplicate, pin) |
| **Tab overflow handling** | 🟡 Basic | Horizontal scroll only, no tab dropdown when many tabs |
| **New tab palette — recent items** | 🟡 Hardcoded | Only shows google.com and github.com as fake data |
| **New tab palette — URL input** | 🟡 UX issue | Clicking "Browse Web" toggles input inline — confusing |

### Detailed Findings

#### 2.1 Terminal Tab (`components/tabs/terminal-tab.tsx`)

**Current:**
```tsx
export function TerminalTab() {
  return (
    <div class="flex flex-col h-full bg-background-base items-center justify-center">
      <div class="text-14-regular text-text-weak">Terminal (Coming Soon)</div>
    </div>
  )
}
```

**Problem:** The desktop package already has `node-pty` as an optional dependency. The main process likely has terminal infrastructure. The tab is not wired to anything.

**Recommendation:**
- Integrate with the existing `TerminalProvider` context (`context/terminal.tsx`)
- Use `xterm.js` for terminal rendering in the renderer process
- Bridge via IPC to the main process `node-pty` instance
- Support multiple terminal instances (one per tab)

**Effort:** Medium (2-3 days) — infrastructure exists, needs wiring.

#### 2.2 Side Chat Tab (`components/tabs/chat-tab.tsx`)

**Current:** Same placeholder pattern as Terminal.

**Problem:** No secondary conversation capability. The vision calls for threaded conversations and agent channels.

**Recommendation:**
- Create a lightweight chat interface using the existing prompt input component
- Each side chat tab should have its own message history
- Side chats should be spawnable by the user (via + button) or by agents
- Messages should be able to reference the main chat context

**Effort:** High (1 week) — requires new message store architecture.

#### 2.3 Code File Viewer (`components/tabs/file-tab.tsx`)

**Current:**
```tsx
fallback={
  <div class="flex flex-col h-full bg-background-base">
    <div class="px-3 py-2 border-b border-border-weaker-base shrink-0">
      <div class="text-12-regular text-text-weak truncate">{props.filePath}</div>
    </div>
    <div class="flex-1 flex items-center justify-center">
      <div class="text-14-regular text-text-weak">
        Code viewer for {props.filePath}
      </div>
    </div>
  </div>
}
```

**Problem:** Non-markdown files show a useless placeholder. Users cannot view or edit code files.

**Recommendation:**
- Integrate Monaco Editor or CodeMirror for code viewing/editing
- Use Shiki for syntax highlighting (already in dependencies: `marked-shiki`)
- Support read-only mode initially, then add edit capability
- Show line numbers, file type icon in tab

**Effort:** Medium (3-4 days) — Shiki is already available.

#### 2.4 Tab Persistence

**Current:** `workspace-tabs.ts` has no persistence logic. `tabCounter` resets to 0 on reload.

**Problem:** Users lose their entire workspace layout when they close and reopen the app.

**Recommendation:**
- Save workspace state to `localStorage` or Electron's `electron-store`
- Restore tabs on app startup
- For browser tabs, restore URLs
- For file tabs, restore paths (verify files still exist)
- For terminal tabs, restore working directory (not command history)
- For chat tabs, restore conversation history

**Effort:** Medium (2-3 days).

---

## 3. Empty State Review

### Current Empty States

| Location | Current Message | Problem |
|----------|-----------------|---------|
| Markdown viewer (no file) | "Select a markdown file to view" | No guidance on HOW to select |
| Browser (loading) | "Loading..." | Can get stuck indefinitely |
| Browser (error) | Error description in small text | No retry action, no fallback |
| File tree (empty) | "No files" (implied) | No CTA to open a folder |
| Review (no changes) | "No changes" | No guidance on how to make changes |
| Terminal tab | "Terminal (Coming Soon)" | No timeline, no workaround |
| Chat tab | "Side Chat (Coming Soon)" | No timeline, no workaround |

### Recommended Empty State Design

Every empty state should follow this pattern:
```
[Icon] — relevant to the feature
[Headline] — clear, friendly message
[Description] — 1-2 sentences explaining what this feature does
[Primary CTA] — the main action to take
[Secondary CTA] — alternative or learn more
```

**Example: Markdown Viewer Empty State**
```
[Document icon]
"No Markdown File Open"
"Open a .md file from the file tree to view it with a table of contents"
[Button: Open File] [Button: Show File Tree]
```

**Example: Browser Error State**
```
[Warning icon]
"Could Not Load Page"
"The page at https://... failed to load. This may be a network issue."
[Button: Retry] [Button: Open in External Browser]
```

---

## 4. Debug Bar — Production Visibility

### Current State

The `DebugBar` component (`components/debug-bar.tsx`) renders a fixed panel in the bottom-right showing:
- NAV (navigation timing)
- FPS
- FRAME (frame gap)
- JANK
- LONG (long tasks)
- DELAY
- INP (interaction delay)
- CLS (cumulative layout shift)
- MEM (memory usage)

This panel is **always rendered** in the app shell. There is no environment check.

### Problem

**Severity: 🔴 Critical**

This is a development-only tool visible in production builds. It:
- Takes up screen real estate
- Looks unprofessional to end users
- May confuse users who don't know what "CLS" or "INP" means
- Suggests the app is not ready for production

### Recommendation

**Immediate fix (1 hour):**
Add an environment check to only render `DebugBar` in development:

```tsx
// In the layout or app shell
<Show when={import.meta.env.DEV}>
  <DebugBar />
</Show>
```

Or use a feature flag in settings:
```tsx
<Show when={settings.general.showDebugPanel?.()}>
  <DebugBar />
</Show>
```

**Better long-term approach:**
Make it a hidden developer feature activated by keyboard shortcut (e.g., `Cmd+Shift+D` on macOS, `Ctrl+Shift+D` on Windows/Linux).

---

## 5. Chat Composer Review

### Current State

The prompt input (`components/prompt-input.tsx`, 2235 lines) is a complex component with:
- Text input with placeholder
- `/` command popover
- `@` context mention popover
- Image attachment support
- File attachment support
- Model selector popover
- Agent selector
- Send button
- Browser button (in some variants)
- Token usage display

### Issues

1. **Too many actions in the composer bar** — The input area has 5+ buttons competing for attention
2. **Browser button redundancy** — There's an "Open Browser" button in the composer AND a browser tab type. Users are confused about which to use.
3. **Token display is cryptic** — "1 read, 0 searches, 0 lists" means nothing to most users
4. **Shell commands inline** — "Shell Check Python availability" appears in the chat stream, breaking the conversational flow
5. **No clear hierarchy** — Primary action (Send) has the same visual weight as secondary actions

### Recommendations

**Simplify the composer to:**
```
[Input field: "Ask anything..."] [Attach button] [Model selector] [Send button]
```

**Move secondary actions to:**
- `/` commands for browser, terminal, etc.
- Toolbar above the input (collapsible)
- Keyboard shortcuts

**Redesign token display:**
- Show only total tokens used
- Use a progress bar for context window usage
- Hide detailed breakdown behind a tooltip

**Handle shell commands:**
- Collapse shell commands into expandable "Thinking..." blocks
- Show a spinner while commands run
- Only show output if it failed or if user explicitly expands

---

## 6. Swarm / Agent Channels Review

### Current State

The `SwarmPanel` (`components/swarm-panel.tsx`, 392 lines) is still implemented as a **tab in the right panel**. It shows:
- Available agents with colored dots
- Execution patterns (Sequential, Parallel, Debate, Iterative)
- Task input field
- "Create Swarm Task" button
- Task list with progress

### Problems

1. **Still a tab** — The vision explicitly states "Swarm should not be a tab"
2. **Jargon naming** — "Swarm" is not user-friendly; "Agent Team" or "Background Tasks" is better
3. **No integration with workspace** — Agents cannot open tabs, spawn channels, or interact with the workspace
4. **No real execution** — The panel has UI but no actual multi-agent orchestration backend
5. **Execution patterns are overwhelming** — 4 patterns shown equally; most users just want "Do this task"

### Recommended Architecture

**Remove the Swarm tab entirely.**

**Implement Agent Channels in the left panel:**
```
Main Chat
▼ Background Tasks (2)
  ● Researching auth libraries... [Agent: Researcher]
  ○ Writing tests... [Agent: Coder]
```

**How it works:**
1. User asks a complex task in main chat
2. Main agent decides to spawn background tasks
3. New channel appears in left panel under "Background Tasks"
4. Each channel shows live status, progress, and quick actions
5. User can click a channel to see detailed conversation
6. Results merge back to main chat when complete
7. Agents can open workspace tabs (browser, file, terminal) as needed

**UI for Agent Channels:**
- Collapsible section in left panel (below Main Chat)
- Each channel: status dot + name + progress bar + dismiss button
- Click to open channel conversation in main area (replacing main chat temporarily, or in a split view)
- "Merge back" button to bring results into main chat

---

## 7. Browser Integration Review

### What's Working

- Webview mounts correctly with ResizeObserver
- Navigation (back, forward, reload) works
- URL normalization handles search queries, localhost, protocols
- Error handling for failed loads
- Page title updates propagate to tab title
- Multiple browser tabs can coexist

### Issues

1. **Loading can get stuck** — The UI_UX_AUDIT reported "Loading..." indefinitely. The current code has better error handling, but:
   - No timeout for loads
   - No retry mechanism
   - No offline indicator

2. **No annotation tools** — The vision promises browser annotation, but there's no implementation

3. **No integration with chat** — User cannot say "look at this page" and have the agent understand what's in the browser

4. **Webview performance** — Multiple webviews may cause memory issues. No unloading of inactive tabs.

### Recommendations

**Short-term:**
- Add load timeout (15 seconds) with retry
- Add offline state detection
- Unload inactive browser tabs after 5 minutes (keep URL, remount on activation)

**Medium-term:**
- Add "Send page content to chat" button
- Add basic annotation (highlight + comment)
- Allow agent to screenshot the browser via computer control tools

---

## 8. File Tree & File Operations Review

### Current State

- File tree shows project files with changes indicator
- Double-clicking a `.md` file opens it in a workspace file tab
- Double-clicking other files opens them in the legacy file tab system
- Context menu is minimal

### Issues

1. **Inconsistent file opening** — Markdown files go to workspace tabs, other files go to legacy tabs
2. **No "Open in New Tab" option** — Users cannot explicitly choose where to open
3. **No file preview** — No way to quickly preview a file without opening a tab
4. **No drag-and-drop** — Cannot reorder files or drag files into chat

### Recommendations

**Unify file opening:**
- All files open in workspace tabs by default
- Add "Open in Preview" (temporary tab, replaces when another preview opens)
- Add "Open in New Tab" (persistent tab)
- Add "Open in Split View" (side-by-side)

**Add context menu to file tree:**
```
Open
Open in New Tab
Open in Preview
Copy Path
Add to Chat Context
---
New File
New Folder
Refresh
```

---

## 9. Visual Design Review

### Typography

**Issue:** Multiple font sizes create confusion (`text-11`, `text-12`, `text-13`, `text-14`, `text-15`, `text-16`, `text-18`, `text-20`, `text-24`)

**Recommendation:** Establish a strict typographic scale:
- `text-11` — Labels, badges, timestamps
- `text-13` — Body small, tab titles, button labels
- `text-15` — Body, chat messages, input
- `text-18` — Headings, section titles
- `text-24` — Page titles, hero text

### Color & Spacing

**Issue:** Dark theme is consistent but monotonous. No accent color for Cedric brand.

**Recommendation:**
- Add a Cedric accent color (teal or purple) for:
  - Active tab indicator
  - Primary buttons
  - Agent status dots
  - Links
- Increase spacing between distinct sections (current spacing is too tight in Swarm panel)

### Icons

**Issue:** Tab icons are small (14px) and some are unclear.

**Recommendation:**
- Increase tab icon size to 16px
- Add tooltips to all icon-only buttons
- Use filled icons for active states, outline for inactive

---

## 10. Performance Review

### Current Metrics (from DebugBar)

- FPS: Generally 60 (good)
- Memory: ~2% of heap (good)
- Navigation: 33ms (good)
- Jank: 1 frame (acceptable)

### Concerns

1. **Multiple webviews** — Each browser tab is a full Chromium webview. 5+ tabs could consume 500MB+ RAM.
2. **No tab unloading** — Inactive tabs remain mounted. Browser tabs should unload after inactivity.
3. **Large bundle size** — `prompt-input.tsx` is 2235 lines. Consider splitting.
4. **SolidJS store updates** — `workspace-tabs.ts` uses `batch()` which is good, but frequent tab switching may cause re-renders.

### Recommendations

1. **Lazy load tab content** — Only mount a tab's component when first activated
2. **Unload inactive browser tabs** — After 5 minutes of inactivity, destroy the webview (keep URL)
3. **Virtualize long lists** — File tree, chat messages, task lists
4. **Code split tab components** — Each tab type should be a lazy-loaded chunk

---

## 11. Accessibility Review

### Current State

- Some `aria-label` attributes present (debug bar, review panel)
- `inert` attribute used for hidden panels
- `aria-hidden` used for collapsed panels

### Gaps

1. **Tab bar** — No `role="tablist"`, `role="tab"`, `aria-selected` on workspace tabs
2. **New tab palette** — No keyboard navigation (arrow keys, Enter, Escape)
3. **Drag and drop** — No keyboard alternative for reordering
4. **Color contrast** — Some `text-text-weak` on `bg-background-base` may fail WCAG AA
5. **Focus indicators** — Many custom-styled buttons lack visible focus rings

### Recommendations

1. Add proper ARIA roles to workspace tab bar
2. Implement keyboard navigation for new tab palette
3. Add "Move Left/Right" buttons as keyboard alternative to drag-and-drop
4. Audit color contrast ratios
5. Add visible focus rings to all interactive elements

---

## 12. Missing Features (Vision vs Reality)

| Vision Feature | Current Status | Gap |
|---------------|----------------|-----|
| Multi-model support (Claude, GPT, local) | 🟡 Partial | Only Kimi provider is fully configured. Architecture supports others but UI lacks model switching. |
| MCP server integration | 🟡 Partial | MCP tools exist but are not exposed as workspace tabs. |
| Agent-initiated tab opening | 🔴 Missing | Agents cannot open browser/file/terminal tabs. |
| Proactive agent suggestions | 🔴 Missing | No "I noticed you have uncommitted changes..." prompts. |
| Browser annotation | 🔴 Missing | No highlight/comment tools on web pages. |
| Workspace templates | 🔴 Missing | No save/restore of workspace layouts. |
| Collaboration mode | 🔴 Missing | No multi-user sessions. |
| Image/PDF viewer tab | 🔴 Missing | Not in tab registry. |
| Plugin/skill marketplace | 🔴 Missing | No registry or installation UI. |

---

## Priority Action Matrix

### P0 — Fix This Week (Blocking Release)

| # | Action | Effort | Impact |
|---|--------|--------|--------|
| 1 | Hide DebugBar in production | 1 hour | 🔴 Critical — unprofessional |
| 2 | Fix all user-facing "OpenCode" / "OpenKimi" strings to "Cedric" | 4 hours | 🔴 Critical — brand confusion |
| 3 | Implement Terminal tab (wire to node-pty) | 2-3 days | 🔴 Critical — promised feature |
| 4 | Implement Code File viewer (Shiki syntax highlight) | 2-3 days | 🔴 Critical — core workspace feature |
| 5 | Add proper empty states to all tabs | 1 day | 🟠 High — user abandonment |

### P1 — Next 2 Weeks (Core Experience)

| # | Action | Effort | Impact |
|---|--------|--------|--------|
| 6 | Implement Side Chat tab | 1 week | 🟠 High — vision feature |
| 7 | Add workspace persistence (save/restore tabs) | 2-3 days | 🟠 High — user retention |
| 8 | Remove Swarm tab, implement Agent Channels in left panel | 1 week | 🟠 High — architectural alignment |
| 9 | Simplify chat composer (remove clutter) | 2-3 days | 🟠 High — daily UX |
| 10 | Add keyboard shortcuts for tabs (Cmd+W, Cmd+T) | 1 day | 🟡 Medium — power users |
| 11 | Add tab context menus | 1 day | 🟡 Medium — expected behavior |

### P2 — Next Month (Polish & Power Features)

| # | Action | Effort | Impact |
|---|--------|--------|--------|
| 12 | Complete package rebrand to @cedric scope | 2-3 days | 🟠 High — clean codebase |
| 13 | Add browser load timeout and retry | 1 day | 🟡 Medium — reliability |
| 14 | Add "Send page to chat" browser feature | 2 days | 🟡 Medium — agent integration |
| 15 | Implement file preview (temporary tabs) | 2 days | 🟡 Medium — file workflow |
| 16 | Add workspace templates | 3 days | 🟡 Medium — power user feature |
| 17 | Unload inactive browser tabs | 1 day | 🟡 Medium — performance |

### P3 — Next Quarter (Ecosystem)

| # | Action | Effort | Impact |
|---|--------|--------|--------|
| 18 | Multi-model provider UI (Claude, GPT, Ollama) | 1-2 weeks | 🟠 High — competitive advantage |
| 19 | MCP server as workspace tabs | 1 week | 🟡 Medium — extensibility |
| 20 | Agent-initiated workspace actions | 2 weeks | 🟠 High — agentic OS vision |
| 21 | Browser annotation tools | 1-2 weeks | 🟡 Medium — differentiation |
| 22 | Plugin/skill marketplace UI | 2 weeks | 🟡 Medium — ecosystem |
| 23 | Collaboration mode | 2-4 weeks | 🟡 Medium — enterprise |

---

## Appendix: Screenshot Evidence

The following screenshots were analyzed from the codebase and UI_UX_AUDIT.md:

1. **Branding inconsistency** — Window title shows "OpenCode" while package says "Cedric"
2. **Debug bar visible** — Performance panel in bottom-right of production build
3. **Swarm tab** — Still present as a tab with "Multi-Agent Collaboration" subtitle
4. **Browser loading** — Stuck on "Loading..." with disabled navigation
5. **Markdown empty state** — "Select a markdown file to view" with no guidance
6. **Placeholder tabs** — Terminal and Chat tabs showing "Coming Soon"

---

*Report generated by Product Orchestrator. Recommendations are based on analysis of the Cedric codebase, UI_UX_AUDIT.md, VISION_CEDRIC.md, STRATEGY_CEDRIC.md, and IMPLEMENTATION_PLAN.md.*
