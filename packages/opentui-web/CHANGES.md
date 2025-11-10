# OpenTUI Web Changes

## TerminalInput Component - November 10, 2025

### Summary

Created a reusable `TerminalInput` component extracted from `MessagesPanel`, with proper keyboard handling, blinking cursor, and expandable options panel.

### New Files

- **`src/grid-components/TerminalInput.tsx`** - Standalone terminal input component
- **`src/examples/TerminalInputDemo.tsx`** - Demo/test component
- **`TERMINAL_INPUT.md`** - Component documentation

### Modified Files

- **`src/grid-components/MessagesPanel.tsx`**
  - Replaced inline input implementation with `<TerminalInput>` component
  - Removed `cursorVisible` prop (now managed internally)
  - Added `onSubmit` prop for message submission
- **`src/grid-components/TerminalLayout.tsx`**
  - Updated props interface: removed `cursorVisible`, added `onSubmit`
  - Passed `onSubmit` handler to MessagesPanel

- **`src/components/TerminalViewNew.tsx`**
  - Removed cursor blinking logic (now in TerminalInput)
  - Added `handleSubmit` function
  - Simplified `onMount` lifecycle (removed cursor interval)
  - Fixed SDK prompt call signature

- **`src/grid-components/index.ts`**
  - Exported `TerminalInput` component

### Bug Fixes (Bonus!)

Fixed all TypeScript errors in the codebase (50+ errors → 0):

#### `src/components/TerminalView.tsx`

- ✅ Added missing layout constants: `SIDEBAR_START`, `SIDEBAR_WIDTH`, `BOTTOM_BAR_ROW_2`
- ✅ Fixed part type check: `"tool_use"` → `"tool"`
- ✅ Added type annotation for `line` parameter
- ✅ Fixed SDK prompt call signature with proper path/body structure
- ✅ Added null check for `currentSession`
- ✅ Fixed undefined `sessions` reference → `allSessions`

#### `src/components/TerminalViewNew.tsx`

- ✅ Fixed SDK prompt call signature
- ✅ Added null check for `firstSession`

#### `src/grid-components/SessionsPanel.tsx`

- ✅ Added null check for `prevSession` in loop

#### `src/terminal/buffer.ts`

- ✅ Fixed potential undefined access in `writeChar`
- ✅ Fixed potential undefined access in `getCell`

### Features

**TerminalInput Component:**

- ✅ Orange `>` prompt (#e5c07b)
- ✅ Blinking cursor (#d19a66, 500ms interval)
- ✅ White text input (#ffffff)
- ✅ Dark background (#0a0a0a)
- ✅ Enter to submit
- ✅ Shift+Enter for newline support
- ✅ Tab to expand options
- ✅ Esc to collapse options
- ✅ Auto-focus on mount
- ✅ Internal cursor state management
- ✅ Grid-based positioning
- ✅ Monospace font rendering

**Options Panel:**

- Shows keyboard shortcuts when expanded:
  - `[a] Agent`, `[m] Model`, `[i] Image`, `[f] File`
  - `[c] Context`, `[t] Tools`, `[p] Plugins`
- Help text: "tab options", "enter send", "shift+enter newline"

### Migration Impact

**Before:**

```tsx
// Parent managed cursor blinking
const [cursorVisible, setCursorVisible] = createSignal(true)
setInterval(() => setCursorVisible(prev => !prev), 500)

<MessagesPanel cursorVisible={cursorVisible()} />
```

**After:**

```tsx
// Cursor managed internally
<TerminalInput value={inputText()} onInput={setInputText} onSubmit={handleSubmit} />
```

### SDK Changes

Fixed incorrect SDK usage throughout codebase:

**Before:**

```typescript
sdk.client.session.prompt(sessionId, { prompt: text })
```

**After:**

```typescript
sdk.client.session.prompt({
  path: { id: sessionId },
  body: { parts: [{ type: "text", text }] },
})
```

### Testing

```bash
cd packages/opentui-web
npm run typecheck  # ✅ 0 errors
npm run dev        # Test in browser
```

### Colors Reference

| Element    | Hex Color | Usage                   |
| ---------- | --------- | ----------------------- |
| Prompt `>` | #e5c07b   | Orange prompt character |
| Cursor `█` | #d19a66   | Blinking cursor block   |
| Input text | #ffffff   | User input text         |
| Background | #0a0a0a   | Main background         |
| Border     | #2a2a2a   | Top border              |
| Help text  | #6a6a6a   | Muted gray              |

### Future Enhancements

- [ ] Command history (Up/Down arrows)
- [ ] Autocomplete suggestions
- [ ] Syntax highlighting
- [ ] Custom placeholder text
- [ ] Ctrl+C to clear input
- [ ] Multi-line textarea mode
