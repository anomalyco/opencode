# Cedric Product Roadmap v2.0

**Version:** 2.0
**Date:** June 2026
**Product:** Cedric — The LLM Operating System
**Status:** Foundation Complete -> Core Workspace Completion In Progress

---

## Vision Recap

Cedric is not a chat app. Cedric is an **LLM Operating System** — a platform-agnostic desktop environment where any LLM (local or cloud) can operate with full tool access, multi-modal capabilities, and extensible workspaces.

**The Dream:** A developer opens Cedric, starts a chat with their local LLM, asks it to "Build a React app with auth". The agent spawns 3 background tasks, opens a browser to check React docs, opens files to write code, opens a terminal to run commands, all while the main chat shows progress. This is what Codex/Claude apps do — but Cedric does it with **ANY model**.

---

## Current State Assessment

### ✅ Completed (As of June 2026)

| Feature | Implementation | Quality |
|---------|---------------|---------|
| Multi-tab workspace architecture | `workspace-tabs.ts`, `workspace-tab-bar.tsx` | ✅ Solid foundation |
| Browser tab (multiple instances) | `browser-tab.tsx` with webview | ✅ Functional |
| Review tab (git changes) | Integrated in side panel | ✅ Functional |
| Markdown file viewer | `markdown-viewer.tsx` with TOC | ✅ Functional |
| Code file viewer | `code-viewer.tsx` with Shiki, line numbers, search, copy, wrap | ✅ Functional read-only |
| Workspace terminal tab | `terminal-tab.tsx` using existing PTY terminal component | ✅ Wired; desktop smoke pending |
| Side Chat tab | `chat-tab.tsx` using independent session-backed conversations | ✅ Functional text chat |
| New tab palette | `new-tab-palette.tsx` | ✅ Basic but working |
| Tab drag-and-drop reordering | `workspace-tab-bar.tsx` | ✅ Functional |
| Tab shortcuts and context menu | `session-side-panel.tsx`, `workspace-tab-bar.tsx` | ✅ Functional |
| Workspace persistence | `workspace-tabs.ts` with per-workspace persisted state | ✅ Functional |
| Desktop package rebrand | `@cedric/desktop` | ✅ Done |
| Kimi provider integration | `packages/llm/src/providers/moonshot.ts` | ✅ Functional |
| Context optimizer (256K) | `kimi-optimizer.ts` | ✅ Functional |
| Computer control tools | Screenshot, click, type, scroll | ✅ Functional |
| File tree with changes indicator | `file-tree.tsx` | ✅ Functional |
| Session management (V2) | Durable prompt admission | ✅ Functional |
| Dark theme & design system | `@cedric/ui` | ✅ Functional |

### 🔄 In Progress / Partial

| Feature | Status | Blocker |
|---------|--------|---------|
| Side Chat polish | Session-backed text chat, per-tab model controls, browser/file context handoff, and main-chat handoff implemented | Needs desktop send/model-response smoke |
| Branding consistency | Desktop package done, rest pending | Coordinated rename required |
| Terminal tab runtime QA | PTY integration wired | Needs live desktop smoke test |
| Agent channels (Swarm v2) | Architecture designed, not implemented | Needs backend orchestration |

### 🔴 Not Started / Missing

| Feature | Priority | Complexity |
|---------|----------|-------------|
| Multi-model UI (Claude, GPT, Ollama) | P1 | Medium |
| MCP server as workspace tabs | P1 | Medium |
| Agent-initiated workspace actions | P1 | High |
| Browser annotation tools | P2 | Medium |
| Workspace templates | P2 | Medium |
| Plugin/skill marketplace | P3 | High |
| Collaboration mode | P3 | High |
| Image/PDF viewer tab | P2 | Low |
| Proactive agent suggestions | P2 | High |

---

## Roadmap Phases

### Phase 0: Critical Fixes (Week 1) — "Production Ready"

**Goal:** Fix all critical issues that prevent Cedric from being used professionally.

#### 0.1 Hide Debug Bar in Production
- **Task:** Add environment check to `DebugBar` rendering
- **File:** `packages/app/src/components/debug-bar.tsx` or app shell
- **Approach:**
  ```tsx
  <Show when={import.meta.env.DEV || settings.general.showDebugPanel?.()}>
    <DebugBar />
  </Show>
  ```
- **Effort:** 1 hour
- **Owner:** Any developer
- **Success Criteria:** Debug bar not visible in production builds

#### 0.2 Fix User-Facing Branding Strings
- **Task:** Replace all user-visible "OpenCode" / "OpenKimi" with "Cedric"
- **Files:**
  - `packages/app/index.html` (title tag)
  - `packages/desktop/src/main/constants.ts` (app name)
  - `packages/desktop/src/main/index.ts` (menu items)
  - `packages/desktop/electron-builder.config.ts` (bundle name)
  - All language/i18n files
  - Window title logic in `titlebar.tsx`
- **Effort:** 4 hours
- **Owner:** Any developer
- **Success Criteria:** No "OpenCode" or "OpenKimi" visible to end users

#### 0.3 Fix Browser Loading Reliability
- **Task:** Add load timeout, retry, and better error states
- **File:** `packages/app/src/components/tabs/browser-tab.tsx`
- **Changes:**
  - Add 15-second load timeout with automatic retry (max 3 attempts)
  - Show offline indicator when network is unavailable
  - Add "Open in External Browser" button on error
  - Improve error message formatting
- **Effort:** 1 day
- **Owner:** Frontend developer
- **Success Criteria:** Browser tab never stuck on "Loading..." indefinitely

#### 0.4 Add Proper Empty States
- **Task:** Design and implement empty states for all workspace tabs
- **Files:**
  - `browser-tab.tsx` — error state redesign
  - `file-tab.tsx` — no file / unsupported file state
  - `terminal-tab.tsx` — placeholder → functional empty state
  - `chat-tab.tsx` — placeholder → functional empty state
  - `markdown-viewer.tsx` — no file selected state
- **Design Pattern:**
  ```
  [Icon] 64px, muted color
  [Headline] 18px semibold, text-base
  [Description] 14px regular, text-weak, max-width 320px
  [Primary CTA] Button, accent color
  [Secondary CTA] Text button or link
  ```
- **Effort:** 1 day
- **Owner:** Frontend developer + designer
- **Success Criteria:** Every tab type has a helpful empty state with clear next action

#### 0.5 Complete Package Rebrand (Internal)
- **Task:** Rename all old scoped packages to `@cedric/*`
- **Files:** All `package.json` files, all import statements, `tsconfig.json` path mappings
- **Approach:**
  1. Update package names in all `package.json`
  2. Run bulk scoped import replacement to `@cedric/`
  3. Update `tsconfig.json` paths
  4. Update `turbo.json` pipeline if needed
  5. Run `bun install` to verify
  6. Run `bun typecheck` in all packages
- **Effort:** 2-3 days
- **Owner:** Senior developer
- **Success Criteria:** Build succeeds, all tests pass, no old scoped package references remain

**Phase 0 Exit Criteria:**
- [x] Debug bar hidden in production
- [x] All user-facing strings say "Cedric"
- [x] Browser tab loads reliably with timeout/retry
- [x] All tabs have proper empty states
- [x] Internal package rename complete
- [x] Package-level typechecks pass from package directories
- [x] App and desktop builds pass

---

### Phase 1: Core Workspace Completion (Weeks 2-3) — "True Multi-Tasking"

**Goal:** Make the workspace tab system fully functional. No more placeholders.

#### 1.1 Implement Terminal Tab
**Status:** Implemented against the existing workspace PTY API and Ghostty terminal renderer. Needs a live desktop smoke test before calling it fully product-verified.

- **Task:** Wire terminal workspace tabs to the existing PTY backend
- **Files:**
  - `packages/app/src/components/tabs/terminal-tab.tsx` (rewrite)
  - `packages/app/src/context/terminal.tsx` (extend for multi-instance)
  - Existing PTY server routes and terminal websocket connection
- **Approach:**
  - Use the existing Ghostty terminal renderer
  - Each terminal tab gets its own PTY session through the server PTY API
  - Support multiple shells (bash, zsh, fish, pwsh)
  - Persist working directory per tab
  - Support copy/paste, clear, resize
- **Dependencies:** `@lydell/node-pty` (already in optionalDependencies)
- **Effort:** 3 days
- **Owner:** Backend + Frontend developer
- **Success Criteria:**
  - [x] Can open multiple terminal tabs
  - [x] Each terminal tab maps to an independent PTY session
  - [ ] Commands execute and output displays correctly in live desktop smoke
  - [x] Terminal uses the existing resize-aware renderer
  - [x] Copy/paste uses the existing terminal UI bindings

#### 1.2 Implement Code File Viewer
**Status:** Implemented as a read-only Shiki viewer with line numbers, copy, wrap, and in-file search.

- **Task:** Add syntax-highlighted code viewing for non-markdown files
- **Files:**
  - `packages/app/src/components/tabs/file-tab.tsx` (rewrite code path)
  - New: `packages/app/src/components/code-viewer.tsx`
- **Approach:**
  - Use Shiki for syntax highlighting (already in dependencies)
  - Support line numbers
  - Support language detection from file extension
  - Read-only mode for v1
  - Show file path breadcrumb in tab
  - Support word wrap toggle
  - Support search within file (Cmd+F)
- **Supported Languages:** TypeScript, JavaScript, Python, Rust, Go, JSON, YAML, HTML, CSS, and 50+ more via Shiki
- **Effort:** 3 days
- **Owner:** Frontend developer
- **Success Criteria:**
  - [x] Can open any code file in workspace tab
  - [x] Syntax highlighting matches file type
  - [x] Line numbers visible
  - [x] File path shown in header
  - [x] Scrollable for large files
  - [x] Search works in the file viewer

#### 1.3 Implement Side Chat Tab
**Status:** Implemented as a lightweight session-backed workspace tab. Each tab creates its own session on first send, renders messages from the normal directory sync store, supports optimistic user messages, aborts active work, and preserves the backing session ID in tab state.

- **Task:** Create functional secondary conversation interface
- **Files:**
  - `packages/app/src/components/tabs/chat-tab.tsx` (rewrite)
  - `packages/app/src/pages/session/session-side-panel.tsx` (tab state wiring)
  - `packages/app/src/context/workspace-tabs.ts` (duplicate-tab session isolation)
- **Approach:**
  - Reuse the existing session create/prompt APIs through `sendFollowupDraft`
  - Each chat tab gets an independent backing session
  - Messages render from the existing `sync.data.message` / `sync.data.part` store
  - Tab state persists the backing `sessionID`; duplicated chat tabs intentionally start fresh
  - Persist per-tab agent/model/variant selections and use them for sends
  - Browser tabs can open a fresh Side Chat with the current URL/title attached as synthetic context
  - File tabs can open a fresh Side Chat with the current file attached as context
  - Browser and file tabs can hand context to the main composer
  - Side Chat drafts can be copied back into the main composer
  - Adopt the generated session title when available
- **Effort:** 1 week
- **Owner:** Frontend + Backend developer
- **Success Criteria:**
  - [x] Can open multiple side chat tabs
  - [x] Each chat has independent conversation
  - [x] Can send messages and receive responses through normal session execution
  - [x] Model selector works per chat
  - [x] Browser page can be handed off to a new side chat as context
  - [x] File tabs can be handed off to a new side chat as context
  - [x] Browser/file context can be handed off to the main chat composer
  - [x] Side Chat draft text can be copied to the main chat composer
  - [x] Tab title shows the first prompt preview, then generated session title when available

#### 1.4 Add Workspace Persistence
**Status:** Implemented for workspace tab state using the existing app persistence helper.

- **Task:** Save and restore workspace tab layout
- **Files:**
  - `packages/app/src/context/workspace-tabs.ts` (extend)
  - `packages/desktop/src/main/store.ts` or use `electron-store`
- **Approach:**
  - Save to `localStorage` (web) or `electron-store` (desktop)
  - Persist: tab list, types, titles, states (URLs, file paths), active tab ID, order
  - Do NOT persist: webview content, terminal output, chat messages
  - Restore on app startup
  - Verify files still exist before restoring file tabs
  - Handle missing/invalid restore gracefully (clear workspace)
- **Schema:**
  ```typescript
  interface PersistedWorkspace {
    version: 1
    tabs: Array<{
      type: WorkspaceTabType
      title: string
    state: Record<string, unknown>
      isPinned: boolean
    }>
    activeTabId: string | null
  }
  ```
- **Effort:** 2-3 days
- **Owner:** Frontend developer
- **Success Criteria:**
  - [x] Workspace restores after app restart
  - [x] Browser tabs restore with correct URLs
  - [x] File tabs restore from persisted tab state
  - [ ] Terminal tabs restore with correct working directory
  - [x] Active tab is restored
  - [x] Graceful handling of invalid persisted state

#### 1.5 Add Keyboard Shortcuts for Tabs
**Status:** Implemented in the session workspace surface.

- **Task:** Implement standard tab keyboard shortcuts
- **Shortcuts:**
  - `Cmd/Ctrl+W` — Close active tab
  - `Cmd/Ctrl+T` — Open new tab palette
  - `Cmd/Ctrl+Shift+T` — Reopen last closed tab
  - `Cmd/Ctrl+1..9` — Switch to tab N
  - `Cmd/Ctrl+Shift+[` / `]` — Previous/Next tab
- **File:** `packages/app/src/context/command.tsx` or new keybind context
- **Effort:** 1 day
- **Owner:** Frontend developer
- **Success Criteria:** Implemented shortcuts: close active tab, open new tab palette, reopen closed tab, switch to tab N, previous tab, next tab.

#### 1.6 Add Tab Context Menus
**Status:** Implemented on workspace tabs.

- **Task:** Right-click menu on tabs
- **Menu Items:**
  - Close
  - Close Others
  - Close All
  - Duplicate (for browser, file tabs)
  - Pin / Unpin
  - Reopen Closed Tab
- **File:** `packages/app/src/components/workspace-tab-bar.tsx`
- **Effort:** 1 day
- **Owner:** Frontend developer
- **Success Criteria:** Context menu appears with activate, duplicate, pin/unpin, close, close others, close all, and reopen closed tab actions.

**Phase 1 Exit Criteria:**
- [ ] Terminal tab live desktop smoke verified
- [x] Code file viewer with syntax highlighting
- [x] Side chat tab functional
- [x] Workspace persists across sessions
- [x] Keyboard shortcuts for tabs work
- [x] Tab context menus work
- [ ] No "Coming Soon" placeholders remain

---

### Phase 2: Agentic Layer (Weeks 4-6) — "The OS Awakens"

**Goal:** Transform Cedric from a multi-tool workspace into an agentic operating system.

#### 2.1 Remove Swarm Tab, Implement Agent Channels
- **Task:** Replace Swarm tab with background agent channels in left panel
- **Files:**
  - Remove: `packages/app/src/components/swarm-panel.tsx` from workspace
  - New: `packages/app/src/components/agent-channels.tsx`
  - Modify: `packages/app/src/pages/session/session-side-panel.tsx` (left panel)
- **Approach:**
  - Add "Background Tasks" collapsible section below Main Chat in left panel
  - Each channel shows: status dot, agent name, task description, progress
  - Click channel to view agent's conversation
  - Dismiss button to cancel task
  - "Merge back" button to bring results to main chat
  - Agent channels are spawned by the main agent, not user-created
- **UI Design:**
  ```
  Main Chat
  ▼ Background Tasks (2)
    ● Researching auth libraries... [Researcher] [×]
    ○ Writing test cases... [Coder] [×]
  ▼ Side Chats (1)
    💬 Database schema discussion [×]
  ```
- **Effort:** 1 week
- **Owner:** Frontend + Backend developer
- **Success Criteria:**
  - [ ] Swarm tab removed from workspace
  - [ ] Background Tasks section visible in left panel
  - [ ] Channels show live status
  - [ ] Can click to view agent conversation
  - [ ] Can dismiss/cancel tasks
  - [ ] Can merge results to main chat

#### 2.2 Agent-Initiated Workspace Actions
- **Task:** Allow agents to open workspace tabs programmatically
- **Files:**
  - `packages/app/src/context/workspace-tabs.ts` (extend with agent API)
  - `packages/core/src/tool/` (new tools: `open_browser`, `open_file`, `open_terminal`)
- **Approach:**
  - Agent can call tool: `open_browser(url)` → opens browser tab
  - Agent can call tool: `open_file(path)` → opens file tab
  - Agent can call tool: `open_terminal(command, cwd)` → opens terminal tab + runs command
  - Agent can call tool: `spawn_channel(name, task)` → creates background agent channel
  - All actions require user confirmation (permission system)
  - Show "Agent is opening..." toast notification
- **Effort:** 1 week
- **Owner:** Backend developer
- **Success Criteria:**
  - [ ] Agent can open browser tabs with URLs
  - [ ] Agent can open file tabs with paths
  - [ ] Agent can open terminal tabs with commands
  - [ ] Agent can spawn background channels
  - [ ] User sees notification for each action
  - [ ] User can deny/approve via permission system

#### 2.3 Proactive Agent Suggestions
- **Task:** Agent suggests actions based on workspace context
- **Examples:**
  - "I noticed you have uncommitted changes. Want me to review them?"
  - "This file has 3 TODO comments. Should I create tasks?"
  - "The terminal shows a build error. Need help fixing it?"
  - "You've been browsing React docs. Want me to scaffold a component?"
- **Approach:**
  - Periodic context scan (every 30 seconds, low priority)
  - Trigger conditions: uncommitted changes, build errors, TODOs, repeated browsing
  - Suggestion appears as a subtle banner above the chat input
  - User can accept, dismiss, or ignore
  - Dismissed suggestions are not shown again for that session
- **Effort:** 1 week
- **Owner:** Backend + AI developer
- **Success Criteria:**
  - [ ] Suggestions appear contextually
  - [ ] Suggestions are relevant and helpful
  - [ ] User can accept or dismiss
  - [ ] Not intrusive (no modal popups)

#### 2.4 Multi-Model Support UI
- **Task:** Allow users to switch between LLM providers per chat
- **Files:**
  - `packages/app/src/components/dialog-select-model.tsx` (extend)
  - `packages/app/src/context/models.tsx` (extend)
  - New providers: `packages/llm/src/providers/anthropic.ts`, `openai.ts`, `ollama.ts`
- **Approach:**
  - Model selector in chat composer shows all configured providers
  - Each side chat can use a different model
  - Each background agent channel can use a different model
  - Provider configuration in settings
  - Visual indicator of which model is active
- **Effort:** 1-2 weeks
- **Owner:** Backend + Frontend developer
- **Success Criteria:**
  - [ ] Can select Kimi, Claude, GPT-4, or local model per chat
  - [ ] Each side chat has independent model
  - [ ] Model indicator visible in composer and tab title
  - [ ] Provider settings page works

**Phase 2 Exit Criteria:**
- [ ] Agent channels replace Swarm tab
- [ ] Agents can open workspace tabs
- [ ] Proactive suggestions appear contextually
- [ ] Multi-model UI functional
- [ ] Permission system handles all agent-initiated actions

---

### Phase 3: Tool Ecosystem (Weeks 7-10) — "Infinite Extensibility"

**Goal:** Make Cedric extensible via MCP servers, plugins, and custom tools.

#### 3.1 MCP Server as Workspace Tabs
- **Task:** Each connected MCP server can open its own tab type
- **Files:**
  - `packages/app/src/context/workspace-tabs.ts` (dynamic tab registry)
  - `packages/app/src/components/tabs/mcp-tab.tsx` (new)
- **Approach:**
  - MCP servers register a tab component via manifest
  - Example: PostgreSQL MCP → Database query tab with table view
  - Example: Browser MCP → Enhanced browser with automation
  - Tab type created dynamically when MCP server connects
  - Tab icon and title from MCP server metadata
- **Effort:** 1 week
- **Owner:** Backend + Frontend developer
- **Success Criteria:**
  - [ ] MCP servers can register tab types
  - [ ] MCP tabs render custom UI
  - [ ] MCP tabs can be opened from + palette
  - [ ] MCP tabs close when server disconnects

#### 3.2 Image & PDF Viewer Tabs
- **Task:** Add media viewer tab types
- **Files:**
  - New: `packages/app/src/components/tabs/image-tab.tsx`
  - New: `packages/app/src/components/tabs/pdf-tab.tsx`
- **Approach:**
  - Image tab: zoom, pan, fit-to-width, download
  - PDF tab: page navigation, zoom, text selection, search
  - Can open from file tree or chat attachment
  - Agent can open images/PDFs for analysis
- **Effort:** 3-4 days
- **Owner:** Frontend developer
- **Success Criteria:**
  - [ ] Can view images in workspace tab
  - [ ] Can view PDFs in workspace tab
  - [ ] Basic zoom and navigation works

#### 3.3 Workspace Templates
- **Task:** Save and restore predefined workspace layouts
- **Examples:**
  - "Web Development": Browser (docs) + Terminal + File (code)
  - "Research": Browser (search) + Browser (paper) + Side Chat
  - "Code Review": Review + File (changes) + Terminal (tests)
- **Approach:**
  - Save current workspace as named template
  - Templates stored in settings
  - Quick-switch templates from toolbar
  - Default template for new sessions
- **Effort:** 3 days
- **Owner:** Frontend developer
- **Success Criteria:**
  - [ ] Can save current workspace as template
  - [ ] Can load template with one click
  - [ ] Templates persist across sessions
  - [ ] Default template option in settings

#### 3.4 Browser Annotation Tools
- **Task:** Allow users to highlight and comment on web pages
- **Files:**
  - `packages/app/src/components/tabs/browser-tab.tsx` (extend)
  - New: annotation overlay system
- **Approach:**
  - Inject content script into webview for highlighting
  - Highlight with color picker (yellow, green, blue, red)
  - Add comment to highlight
  - Annotations persist per URL (stored locally)
  - "Send annotations to chat" button
  - Agent can read annotations for context
- **Effort:** 1-2 weeks
- **Owner:** Frontend developer
- **Success Criteria:**
  - [ ] Can highlight text on web pages
  - [ ] Can add comments to highlights
  - [ ] Annotations persist across sessions
  - [ ] Can send annotations to chat

#### 3.5 Plugin/Skill Registry UI
- **Task:** UI for discovering and installing plugins
- **Files:**
  - New: `packages/app/src/pages/plugins.tsx`
  - New: `packages/app/src/components/plugin-card.tsx`
- **Approach:**
  - Browse available plugins from registry
  - Install/uninstall with one click
  - View plugin permissions
  - Enable/disable without uninstalling
  - Plugin settings page
- **Effort:** 1 week
- **Owner:** Frontend + Backend developer
- **Success Criteria:**
  - [ ] Can browse plugin catalog
  - [ ] Can install plugins
  - [ ] Can manage installed plugins
  - [ ] Plugin permissions visible

**Phase 3 Exit Criteria:**
- [ ] MCP servers can create tab types
- [ ] Image and PDF viewers work
- [ ] Workspace templates save/load
- [ ] Browser annotation functional
- [ ] Plugin registry UI functional

---

### Phase 4: Advanced Features (Weeks 11-16) — "Enterprise Ready"

**Goal:** Add collaboration, advanced agent workflows, and enterprise features.

#### 4.1 Collaboration Mode
- **Task:** Multi-user sessions for pair programming
- **Approach:**
  - Share session link
  - Real-time cursor sync
  - Shared workspace tabs
  - Voice chat integration (optional)
  - Permission levels (viewer, editor, admin)
- **Effort:** 2-4 weeks
- **Owner:** Full team

#### 4.2 Advanced Agent Workflows
- **Task:** Multi-step, long-running agent tasks
- **Examples:**
  - "Refactor the entire codebase to TypeScript strict mode"
  - "Write comprehensive documentation for this project"
  - "Set up CI/CD pipeline with tests"
- **Approach:**
  - Task decomposition into sub-tasks
  - Progress tracking with milestones
  - Human-in-the-loop checkpoints
  - Resume after interruption
  - Task history and replay
- **Effort:** 2 weeks
- **Owner:** Backend + AI developer

#### 4.3 Local-First Mode
- **Task:** Full functionality with local models, no cloud required
- **Approach:**
  - Ollama integration for local LLMs
  - Local embedding for search
  - Offline workspace persistence
  - Sync when connection restored
- **Effort:** 1-2 weeks
- **Owner:** Backend developer

#### 4.4 Mobile Companion App
- **Task:** iOS/Android app for chat and notifications
- **Approach:**
  - React Native or Capacitor
  - Sync conversations with desktop
  - Push notifications for agent tasks
  - Quick replies and approvals
- **Effort:** 4-6 weeks
- **Owner:** Mobile developer

---

## Success Metrics by Phase

### Phase 0
- Zero "OpenCode" / "OpenKimi" visible in UI
- Debug bar not visible in production
- Browser tab loads successfully 100% of first attempts
- All empty states have clear CTAs

### Phase 1
- Average 3+ tabs open per session
- Terminal tab used in 50% of sessions
- Code files opened in 70% of sessions
- Workspace restores correctly for 95% of users

### Phase 2
- Agent channels spawned in 30% of complex tasks
- Agent-initiated tab opens accepted by users 80% of time
- Proactive suggestions accepted 20% of time
- Multi-model usage: 40% of users try 2+ models

### Phase 3
- MCP tab types: 5+ servers registered
- Workspace templates: 3+ default templates
- Browser annotations: used in 25% of research tasks
- Plugins installed: average 2+ per user

### Phase 4
- Collaboration: 10% of sessions are multi-user
- Agent workflows: 15% of tasks use multi-step
- Local-first: 30% of users use local models

---

## Dependencies & Risks

### Critical Dependencies

| Dependency | Current Status | Risk |
|-----------|---------------|------|
| `node-pty` | Available, optional | Low — already integrated in desktop |
| `xterm.js` | Not in dependencies | Low — add to package.json |
| Shiki | Available (`marked-shiki`) | Low — already used for markdown |
| Electron webview | Functional | Medium — may be deprecated in future Electron versions |
| Effect-TS | Core architecture | Low — stable, well-maintained |
| SolidJS | UI framework | Low — stable, performant |

### Risks & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Electron webview deprecation | Medium | High | Evaluate `BrowserView` or `iframe` alternatives |
| Package rename breaks build | Medium | High | Test in branch, CI validation |
| Terminal integration complexity | Medium | Medium | Start with basic shell, iterate |
| Agent channels backend load | Medium | High | Rate limit, queue tasks, user controls |
| Multi-model API costs | Low | Medium | Clear usage indicators, spending limits |

---

## Team Structure (Recommended)

| Role | Focus | Headcount |
|------|-------|-----------|
| Frontend Lead | UI components, workspace tabs, design system | 1 |
| Backend Lead | Agent system, MCP integration, providers | 1 |
| Full-Stack Developer | Terminal, file viewer, persistence | 1 |
| AI/ML Engineer | Agent behavior, proactive suggestions, model optimization | 1 |
| Designer | Empty states, icons, animations, UX flow | 1 (part-time) |
| QA / DevOps | Testing, CI/CD, release management | 1 (part-time) |

---

## Release Schedule

| Milestone | Target Date | Contents |
|-----------|-------------|----------|
| v0.5.0 (Alpha) | Week 1 end | Phase 0 complete — production-ready branding |
| v0.6.0 (Beta) | Week 3 end | Phase 1 complete — full workspace functionality |
| v0.7.0 (Preview) | Week 6 end | Phase 2 complete — agentic layer |
| v0.8.0 (RC) | Week 10 end | Phase 3 complete — tool ecosystem |
| v1.0.0 (Launch) | Week 16 end | Phase 4 complete — enterprise features |

---

## Appendix A: File Inventory for Implementation

### New Files to Create

```
packages/app/src/
  components/
    agent-channels.tsx          # Background task UI in left panel
    code-viewer.tsx             # Syntax-highlighted code viewer
    tabs/
      image-tab.tsx             # Image viewer
      pdf-tab.tsx               # PDF viewer
      mcp-tab.tsx               # Dynamic MCP server tab
  context/
    side-chat.tsx               # Side chat message store
    workspace-persistence.ts    # Save/restore workspace
  pages/
    plugins.tsx                 # Plugin registry page
    templates.tsx               # Workspace templates page

packages/llm/src/providers/
  anthropic.ts                  # Claude provider
  openai.ts                     # GPT provider
  ollama.ts                     # Local model provider

packages/core/src/tool/
  open-browser.ts               # Agent tool: open browser
  open-file.ts                  # Agent tool: open file
  open-terminal.ts              # Agent tool: open terminal
  spawn-channel.ts              # Agent tool: spawn background agent
```

### Files to Modify

```
packages/app/src/
  components/
    debug-bar.tsx               # Hide in production
    file-tab.tsx                # Add code viewer
    markdown-viewer.tsx         # Better empty state
    new-tab-palette.tsx         # Add image/PDF/MCP options
    prompt-input.tsx            # Simplify, remove clutter
    swarm-panel.tsx             # Remove from workspace (keep for reference)
    terminal-tab.tsx            # Wire to node-pty
    chat-tab.tsx                # Implement chat interface
    titlebar.tsx                # Fix window title
    workspace-tab-bar.tsx       # Add context menu, keyboard shortcuts
  context/
    workspace-tabs.ts           # Add persistence, agent API
  pages/
    session/
      session-side-panel.tsx    # Add agent channels to left panel

packages/desktop/src/
  main/
    index.ts                    # Update protocol, menu
    constants.ts                # Update app name
  electron-builder.config.ts    # Update bundle ID, protocol

packages/app/index.html         # Update title
packages/*/package.json         # Rename to @cedric/*
```

### Files to Delete

```
# After Swarm is fully replaced by Agent Channels:
# packages/app/src/components/swarm-panel.tsx (or move to archive/)
```

---

## Appendix B: Competitive Tracking

| Feature | Codex App | Claude App | Cursor | Cedric Target | Cedric Current |
|---------|-----------|------------|--------|---------------|----------------|
| Multi-model | ❌ | ❌ | 🟡 | ✅ | 🟡 (Kimi only) |
| Local models | ❌ | ❌ | ✅ | ✅ | 🟡 (Ollama planned) |
| Multi-browser | ❌ | ❌ | ❌ | ✅ | ✅ |
| Multi-file tabs | ✅ | ✅ | ✅ | ✅ | ✅ |
| Terminal | ❌ | ❌ | ✅ | ✅ | 🟡 (wired; desktop smoke pending) |
| Agent swarms | ❌ | ❌ | ❌ | ✅ | ❌ (Swarm tab) |
| Side chats | ❌ | ❌ | ❌ | ✅ | 🟡 (functional; desktop smoke pending) |
| MCP tools | ❌ | ❌ | 🟡 | ✅ | 🟡 (backend only) |
| Browser annotation | ❌ | ❌ | ❌ | ✅ | ❌ |
| Workspace templates | ❌ | ❌ | ❌ | ✅ | ❌ |
| Collaboration | ❌ | ❌ | ✅ | ✅ | ❌ |
| Vendor lock-in | 🔒 | 🔒 | 🟡 | 🔓 | 🔓 |

---

*Roadmap v2.0 — Maintained by Product Orchestrator. Update weekly during sprints.*
