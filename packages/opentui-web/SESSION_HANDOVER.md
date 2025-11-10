# OpenTUI Web - Session Handover

## 🎯 Mission: Pixel-Perfect TUI Recreation in Web

**Goal:** Create a web version of the OpenCode TUI that is IDENTICAL when overlaid with transparency. Users should not be able to tell the difference.

## ✅ Completed Work

### 1. **New Components Created**

- `session-navigation.tsx` - Top navigation bar with ← Back to parent, ← Previous, Next → buttons
- `message-bubble.tsx` - TUI-style message bubbles with timestamps, tool badges, expandable outputs
- `bottom-bar.tsx` - Bottom status bar with model selector, version info, keyboard shortcuts
- `header-bar.tsx` - Top header with logo and command palette (may not be needed)

### 2. **Updated Components**

- `message-list.tsx` - Simplified to use new MessageBubble component, removed old renderers
- Added Berkeley Mono font to `index.html`
- Changed base background from `#1e1e1e` to `#1a1a1a` (darker, matches TUI)

### 3. **Key Features Implemented**

- ✅ Tool call badges (CC_READ, CC_BASH, etc.) with gray background `#3a3a3a`
- ✅ Collapsible tool outputs with ▶ triangles
- ✅ User message left border in yellow/gold `#d4a233`
- ✅ Timestamps formatted as `(5:13:29 PM)`
- ✅ Model selector dropdown in bottom bar
- ✅ Navigation controls in top bar

## 🚧 Remaining Work

### 1. **SessionDetail Component** (HIGH PRIORITY)

**File:** `/packages/opentui-web/src/components/session-detail.tsx`

**What to do:**

```tsx
// Remove the old tabbed interface (Todos/Diffs tabs)
// Replace with clean layout:
import { SessionNavigation } from "./session-navigation"
import { BottomBar } from "./bottom-bar"

// Structure should be:
;<div>
  <SessionNavigation />
  <MessageList />
  <PromptInput />
  <BottomBar />
</div>
```

**Why:** Currently SessionDetail has old tabs and styling. Need to strip it down to match TUI's clean message-only view.

### 2. **PromptInput Styling** (HIGH PRIORITY)

**File:** `/packages/opentui-web/src/components/prompt-input.tsx`

**What to do:**

- Remove the character counter and fancy styling
- Make it a simple dark input box at bottom
- Should blend seamlessly with BottomBar above it
- Remove file attachment UI (not in TUI)
- Style:
  ```css
  background: #1a1a1a
  border-top: 1px solid #3e3e3e
  padding: 0.75rem 1rem
  ```

### 3. **Sidebar Redesign** (HIGH PRIORITY)

**File:** `/packages/opentui-web/src/components/sidebar.tsx`

**Match TUI screenshot exactly:**

- Top section: "CODESURF" header (gray, right-aligned)
- Server info: `server:61417/`
- Session title below
- Context bar with colored segments:
  - System (gray)
  - AI (blue)
  - User (purple)
  - Tool (yellow/orange)
- Show `143,429 tokens (99% cached)` and `72% used`
- Cost: `$0.00 spent (saved $0.00)`
- Tabs: `● Tools(14)` `○ Todos(0)` `○ Files(7)`
- Collapsible sections below:
  - `▼ Subagents (0)` with `+ Add Subagent` button
  - `▶ Tools Used (4)`
  - `▶ Plugins (10)`

### 4. **Colors to Match** (CRITICAL)

```css
/* Background */
--bg-main: #1a1a1a --bg-panel: #1e1e1e --bg-hover: #2e2e2e /* Borders */ --border-main: #3e3e3e --border-light: #5e5e5e
  /* Text */ --text-main: #d4d4d4 --text-muted: #6a6a6a --text-accent: #4ec9b0 (cyan) /* User message bar */
  --user-accent: #d4a233 (gold/yellow) /* Tool badges */ --badge-bg: #3a3a3a --badge-border: #5e5e5e;
```

### 5. **SessionView Update** (MEDIUM)

**File:** `/packages/opentui-web/src/components/session-view.tsx`

Currently has HeaderBar - should this be removed? TUI doesn't have it.
Focus on session list (left), message area (center), sidebar (right).

## 📋 Quick Fixes Needed

1. **Fix API call error** ✅ DONE
   - Changed from `session.message()` to `session.prompt()`
   - Uses `parts: [{ type: "text", text: "..." }]`

2. **Background color** ✅ DONE
   - Changed from `#1e1e1e` to `#1a1a1a`

3. **Font** ✅ DONE
   - Added Berkeley Mono from Google Fonts

## 🔧 Technical Notes

### API Integration

- SDK client: `@opencode-ai/sdk/client`
- Main methods:
  - `client.session.list()` - Get sessions
  - `client.session.get({ path: { id } })` - Get session details
  - `client.session.prompt({ path: { id }, body: { parts } })` - Send message
  - `client.session.messages({ path: { id } })` - Get messages

### Context Providers

- `SDKProvider` - Provides SDK client and event streaming
- `SyncProvider` - Manages reactive state (sessions, messages, todos, etc.)
- Access via `useSDK()` and `useSync()`

### State Structure

```ts
sync.data = {
  session: Session[]
  message: { [sessionID: string]: Message[] }
  part: { [messageID: string]: Part[] }
  todo: { [sessionID: string]: Todo[] }
  session_diff: { [sessionID: string]: FileDiff[] }
  mcp: { [key: string]: MCPServer }
  lsp: LSPServer[]
  plugin: Plugin[]
  provider: Provider[]
}
```

## 🎨 Design Philosophy

**EVERY PIXEL MATTERS**

- User wants to overlay web version on TUI with transparency
- Should be IMPOSSIBLE to tell them apart
- Spacing, colors, fonts, borders - all IDENTICAL
- No web-isms, no fancy animations, pure TUI aesthetic

## 🚀 Next Steps

1. **Read and update SessionDetail** - Remove tabs, use new components
2. **Strip down PromptInput** - Make it minimal like TUI
3. **Rebuild Sidebar** - Match screenshot exactly
4. **Test overlay** - Screenshot TUI, screenshot web, overlay with 50% opacity
5. **Iterate** - Fix any differences until perfect

## 📝 Files Changed

**New Files:**

- `src/components/session-navigation.tsx`
- `src/components/message-bubble.tsx`
- `src/components/bottom-bar.tsx`
- `src/components/header-bar.tsx` (may not be needed)

**Modified Files:**

- `src/components/message-list.tsx` - Simplified, uses MessageBubble
- `index.html` - Added Berkeley Mono font
- `src/app.tsx` - Added HeaderBar (may remove later)
- `src/components/prompt-input.tsx` - Fixed API call to use `prompt()`

**To Modify:**

- `src/components/session-detail.tsx` - Replace layout
- `src/components/prompt-input.tsx` - Simplify styling
- `src/components/sidebar.tsx` - Complete redesign
- `src/components/session-view.tsx` - Consider removing HeaderBar

## 💡 Key Insights

1. **TUI has NO top header** - Just navigation bar in session view
2. **User messages have LEFT BORDER** - Yellow/gold color `#d4a233`
3. **Tool badges are INLINE** - Not in separate boxes, part of message flow
4. **Bottom bar is STATUS** - Not just input, shows model, version, shortcuts
5. **Sidebar tabs use CIRCLES** - `●` for active, `○` for inactive
6. **Everything is DARK** - Base is `#1a1a1a`, not `#1e1e1e`

## 🎯 Success Criteria

✅ When overlaid at 50% opacity, web and TUI are indistinguishable
✅ All colors match exactly
✅ Spacing and padding identical
✅ Font rendering similar (Berkeley Mono)
✅ Interactive elements (buttons, dropdowns) styled like TUI
✅ User goes "HOLY SHIT THIS IS IDENTICAL" 🔥
