# Cedric Implementation Plan: Phase A + B

## Overview
**Phase A:** Multi-Tab Workspace (Core Foundation)
**Phase B:** Cedric Rebrand (Identity)

**Key Principle:** Build on OpenCode's existing strengths (multi-LLM support, MCP servers, agent system)

---

## Phase A: Multi-Tab Workspace

### Current State Analysis
```
Right Panel (Static Tabs):
- Review (Git changes)
- Browser (Single webview)
- Markdown (Single file viewer)
- Swarm (To be removed)

Problems:
- Only 1 browser instance
- Only 1 file view at a time
- No terminal
- No side chats
- No plugin tabs
```

### Target State
```
Right Panel (Dynamic Tabs):
- Review* (Pinned, git changes)
- Browser: Google (Webview #1)
- Browser: React Docs (Webview #2)
- auth.ts (Code viewer)
- README.md (Markdown viewer)
- Terminal (Shell)
- + (New tab button)
- Open File (Quick action)

*Pinned tabs always visible
```

### Architecture

#### 1. Tab Registry System
```typescript
// packages/app/src/context/workspace-tabs.ts

interface TabType {
  id: string
  name: string
  icon: string
  component: Component
  canOpenMultiple: boolean
  allowClose: boolean
  defaultState?: any
}

const tabRegistry: Record<string, TabType> = {
  review: {
    id: 'review',
    name: 'Review',
    icon: 'git-compare',
    component: ReviewTab,
    canOpenMultiple: false,
    allowClose: false, // Pinned
  },
  browser: {
    id: 'browser',
    name: 'Browser',
    icon: 'globe',
    component: BrowserTab,
    canOpenMultiple: true,
    allowClose: true,
  },
  file: {
    id: 'file',
    name: 'File',
    icon: 'file',
    component: FileTab,
    canOpenMultiple: true,
    allowClose: true,
  },
  terminal: {
    id: 'terminal',
    name: 'Terminal',
    icon: 'terminal',
    component: TerminalTab,
    canOpenMultiple: true,
    allowClose: true,
  },
  chat: {
    id: 'chat',
    name: 'Chat',
    icon: 'message-square',
    component: SideChatTab,
    canOpenMultiple: true,
    allowClose: true,
  },
}
```

#### 2. Tab State Management
```typescript
interface WorkspaceTab {
  id: string           // Unique tab ID (e.g., "browser-1", "file-auth.ts")
  type: string         // Tab type from registry
  title: string        // Display title
  state: any          // Type-specific state
  isPinned?: boolean
  isActive: boolean
}

interface WorkspaceState {
  tabs: WorkspaceTab[]
  activeTabId: string | null
  pinnedTabs: string[]  // Always visible
}
```

#### 3. Tab Bar Component
```
[Review*] [Browser: Google] [x] [auth.ts] [x] [+] [Open File]
         └─ closable     └─ closable
```

Features:
- Drag to reorder
- Close button (x) on hover
- Pin/Unpin option
- Context menu (close others, close all, duplicate)

#### 4. New Tab Button (+)
Click opens palette:
```
New Tab:
├── Browse Web
│   └── [URL input field]
├── Open File...
│   └── [File picker dialog]
├── New Terminal
├── New Side Chat
├── Open Recent:
│   ├── google.com
│   ├── auth.ts
│   └── README.md
└── [Divider]
    Tools:
    ├── Git Review (if not open)
    ├── Image Viewer
    └── PDF Viewer
```

### Implementation Steps

#### Step 1: Create Workspace Tab Context
**File:** `packages/app/src/context/workspace-tabs.tsx`
- Tab registry system
- Tab state management (SolidJS store)
- Tab CRUD operations
- Tab persistence (save/restore layout)

#### Step 2: Create Dynamic Tab Bar
**File:** `packages/app/src/components/workspace-tab-bar.tsx`
- Horizontal tab bar with scroll
- Tab items with icons, titles, close buttons
- Drag-and-drop reordering
- "+" button with creation palette
- "Open File" quick action

#### Step 3: Create Tab Components
Refactor existing panels into tab-compatible components:

**Browser Tab** (`components/tabs/browser-tab.tsx`):
- Extract from browser-panel.tsx
- Support multiple instances (each with own URL)
- Independent navigation state

**File Tab** (`components/tabs/file-tab.tsx`):
- Extract from markdown-viewer.tsx
- Support code files (syntax highlighting)
- Support markdown files (preview mode)
- Multiple files open simultaneously

**Review Tab** (`components/tabs/review-tab.tsx`):
- Extract from session-review-tab.tsx
- Pinned by default
- Shows git changes

**Terminal Tab** (`components/tabs/terminal-tab.tsx`):
- New component
- Integrated terminal
- Multiple terminal instances

#### Step 4: Refactor Session Side Panel
**File:** `packages/app/src/pages/session/session-side-panel.tsx`
- Replace static Tabs with dynamic WorkspaceTabs
- Remove Swarm tab
- Integrate new tab bar
- Handle tab switching

#### Step 5: Update File Tree Interaction
**File:** `packages/app/src/components/file-tree.tsx`
- Double-click or "Open in Tab" opens file in new workspace tab
- "Open in Preview" opens markdown in tab
- Context menu: "Open in New Tab"

#### Step 6: Browser Integration
**File:** `packages/app/src/components/browser-panel.tsx` → `components/tabs/browser-tab.tsx`
- Make each browser instance independent
- Each tab has own URL bar, navigation, webview
- Support multiple simultaneous browsers

### Files to Modify
1. `packages/app/src/context/workspace-tabs.tsx` (NEW)
2. `packages/app/src/components/workspace-tab-bar.tsx` (NEW)
3. `packages/app/src/components/tabs/browser-tab.tsx` (NEW)
4. `packages/app/src/components/tabs/file-tab.tsx` (NEW)
5. `packages/app/src/components/tabs/review-tab.tsx` (NEW)
6. `packages/app/src/components/tabs/terminal-tab.tsx` (NEW)
7. `packages/app/src/pages/session/session-side-panel.tsx` (MODIFY)
8. `packages/app/src/components/browser-panel.tsx` (MODIFY/DELETE)
9. `packages/app/src/components/markdown-viewer.tsx` (MODIFY/DELETE)
10. `packages/app/src/components/file-tree.tsx` (MODIFY)

---

## Phase B: Cedric Rebrand

### Scope
1. **App Name:** OpenCode/OpenKimi → Cedric
2. **Protocol:** openkimi:// → cedric://
3. **Bundle ID:** dev.openkimi.desktop.dev → dev.cedric.desktop.dev
4. **Window Title:** "OpenCode" → "Cedric"
5. **Menu Items:** Replace "OpenCode" with "Cedric"
6. **Icons:** Update app icons
7. **Documentation:** Update README, docs
8. **Configuration:** Update config files

### Files to Modify
1. `packages/desktop/package.json`
2. `packages/desktop/electron-builder.yml`
3. `packages/desktop/src/main/index.ts`
4. `packages/app/index.html`
5. `packages/app/src/app.tsx`
6. `packages/desktop/resources/Info.plist`
7. All documentation files

### Brand Elements
- **Name:** Cedric
- **Tagline:** "Your LLM Operating System"
- **Protocol:** cedric://
- **Bundle ID:** dev.cedric.desktop
- **Color Scheme:** Keep dark theme, add Cedric accent color

---

## Leveraging OpenCode Strengths

### Multi-LLM Support
OpenCode already supports:
- ✅ Multiple providers (Anthropic, OpenAI, local)
- ✅ Per-chat model selection
- ✅ Provider switching

**Action:** Ensure Cedric inherits this capability

### MCP Server Support
OpenCode already supports:
- ✅ MCP tool servers
- ✅ Tool registry
- ✅ Tool calling

**Action:** Each MCP server can be a workspace tab type

### Agent System
OpenCode already has:
- ✅ Agent modes (build, ask, plan, docs)
- ✅ Agent switching
- ✅ Agent-specific prompts

**Action:** Agents can open workspace tabs dynamically

---

## Implementation Order

### Week 1: Foundation
**Day 1-2:**
- [ ] Create workspace-tabs context
- [ ] Create tab registry system
- [ ] Implement tab state management

**Day 3-4:**
- [ ] Create workspace-tab-bar component
- [ ] Implement tab rendering
- [ ] Add close buttons, drag reorder

**Day 5:**
- [ ] Create "+" button with creation palette
- [ ] Implement tab creation logic
- [ ] Test multiple tab types

### Week 2: Tab Components
**Day 1-2:**
- [ ] Refactor Browser into browser-tab
- [ ] Support multiple browser instances
- [ ] Each browser gets own URL/state

**Day 3-4:**
- [ ] Refactor File Viewer into file-tab
- [ ] Support code files + markdown
- [ ] Multiple files simultaneously

**Day 5:**
- [ ] Refactor Review into review-tab
- [ ] Make pinned by default
- [ ] Test integration

### Week 3: Integration
**Day 1-2:**
- [ ] Refactor session-side-panel
- [ ] Remove static tabs
- [ ] Integrate dynamic workspace

**Day 3-4:**
- [ ] Update file tree interactions
- [ ] Open files in new tabs
- [ ] Context menu actions

**Day 5:**
- [ ] Terminal tab implementation
- [ ] Side chat tab stub
- [ ] Polish and testing

### Week 4: Cedric Rebrand
**Day 1-2:**
- [ ] Update package names
- [ ] Update bundle IDs
- [ ] Update protocol handlers

**Day 3-4:**
- [ ] Update window titles
- [ ] Update menu items
- [ ] Update app metadata

**Day 5:**
- [ ] Update documentation
- [ ] Create new icons
- [ ] Final testing

---

## Testing Strategy

### Workspace Tabs
1. Open 5+ browser tabs simultaneously
2. Open multiple files
3. Reorder tabs via drag
4. Close tabs individually
5. Pin/unpin tabs
6. Create tabs from "+" palette
7. Open files from tree into tabs
8. Verify persistence across sessions

### Multi-Browser
1. Navigate to different URLs in each browser
2. Verify independent navigation
3. Test browser automation per tab
4. Verify performance with 3+ browsers

### Cedric Rebrand
1. Verify app name in menu bar
2. Verify window title
3. Verify protocol handler
4. Verify bundle ID
5. Check all user-facing strings

---

## Success Criteria

### Phase A Complete When:
- [ ] User can open 3+ browser tabs
- [ ] User can open 3+ file tabs
- [ ] User can reorder tabs
- [ ] User can close individual tabs
- [ ] "+" button opens creation palette
- [ ] File tree opens files in new tabs
- [ ] Review tab is pinned by default
- [ ] Layout persists across sessions

### Phase B Complete When:
- [ ] App displays "Cedric" everywhere
- [ ] Protocol is cedric://
- [ ] Bundle ID is dev.cedric.desktop
- [ ] No "OpenCode" or "OpenKimi" references remain
- [ ] New icons applied

---

## Risks & Mitigation

### Risk 1: Breaking Existing Features
**Mitigation:** Keep existing components working, wrap in tab containers

### Risk 2: Performance with Many Tabs
**Mitigation:** Lazy load tab content, unload inactive tabs

### Risk 3: State Management Complexity
**Mitigation:** Use SolidJS stores, clear tab state boundaries

### Risk 4: Rebrand Breaking Updates
**Mitigation:** Search/replace comprehensively, test all paths

---

## Future Enhancements (Post Phase A/B)

### Agent Channels (Swarm v2)
- Background agent tasks
- Side chat threads
- Agent-initiated tab opening

### Plugin System
- MCP servers as tab types
- Third-party tab extensions
- Custom tool integrations

### Advanced Workspace
- Tab groups/folders
- Workspace layouts (save/restore)
- Split view (side-by-side tabs)
- Floating tabs (detachable windows)

---

## Conclusion

**Phase A** transforms Cedric from a chat app with tools into a true workspace environment.
**Phase B** establishes Cedric's identity as a standalone platform.

By leveraging OpenCode's multi-LLM support, Cedric will be the first truly open LLM operating system.

**Let's build it.**
