# TerminalInput Component

A reusable terminal-style input component for the OpenTUI web interface.

## Features

### Visual Design

- ✅ Orange `>` prompt character (#e5c07b)
- ✅ Blinking orange cursor block (#d19a66) at 500ms intervals
- ✅ Dark gray background (#0a0a0a with #2a2a2a border)
- ✅ White text input (#ffffff)
- ✅ Fixed position at bottom of viewport

### Functionality

- ✅ Real-time keyboard input capture
- ✅ Blinking cursor at text end
- ✅ **Enter** to submit message
- ✅ **Shift+Enter** for newline (multiline support)
- ✅ **Tab** to expand options panel
- ✅ **Esc** to collapse options panel
- ✅ Auto-focus on mount

### Layout

- Expandable height (4.5em collapsed, 12em expanded)
- Options panel shows when expanded with shortcuts:
  - `[a] Agent`, `[m] Model`, `[i] Image`, `[f] File`
  - `[c] Context`, `[t] Tools`, `[p] Plugins`
- Help text at bottom:
  - "tab options" / "esc close options"
  - "enter send"
  - "shift+enter newline"

## Usage

### Basic Example

```tsx
import { TerminalInput } from "@opencode-ai/opentui-web"

const [inputText, setInputText] = createSignal("")

const handleSubmit = (text: string) => {
  console.log("Submitted:", text)
  setInputText("")
}

;<TerminalInput value={inputText()} onInput={setInputText} onSubmit={handleSubmit} width={74} />
```

### With Attachments (Badges)

```tsx
import { TerminalInput, type Attachment } from "@opencode-ai/opentui-web"

const [inputText, setInputText] = createSignal("")
const [attachments, setAttachments] = createSignal<Attachment[]>([
  { type: "image", label: "Image 1" },
  { type: "file", label: "data.json" }
])

<TerminalInput
  value={inputText()}
  onInput={setInputText}
  onSubmit={handleSubmit}
  width={74}
  attachments={attachments()}
/>
```

This will render as: `> [Image 1] [data.json] your text here█`

### Props

```typescript
interface Attachment {
  type: "image" | "file" // Type of attachment
  label: string // Display label (e.g., "Image 1", "data.json")
}

interface TerminalInputProps {
  value: string // Current input value
  onInput: (value: string) => void // Called on each keystroke
  onSubmit?: (value: string) => void // Called on Enter key
  width?: number // Width in characters (default: 74)
  placeholder?: string // Placeholder text (not implemented yet)
  showOptions?: boolean // Control options visibility (not used yet)
  onToggleOptions?: (expanded: boolean) => void // Called when options expand/collapse
  attachments?: Attachment[] // Array of attachments to display as badges
}
```

## Implementation Details

### Cursor Blinking

- Uses `setInterval` with 500ms delay
- Managed internally with `createSignal` and `onMount`/`onCleanup`
- Cursor renders as `█` character with color #d19a66

### Keyboard Handling

- Transparent `<input>` element captures keystrokes
- Visible text rendered with `GridText` components
- Key events handled with `onKeyDown`:
  - `Tab` → Toggle options (preventDefault)
  - `Escape` → Close options (preventDefault)
  - `Enter` (no Shift) → Submit (preventDefault)
  - `Shift+Enter` → Allow default (newline)

### Grid Positioning

- Prompt `>` at col 0
- Text starts at col 2
- Cursor at col 2 + text.length
- Uses monospace font: "Berkeley Mono", "JetBrains Mono"

## Files

- **Component**: `src/grid-components/TerminalInput.tsx`
- **Demo**: `src/examples/TerminalInputDemo.tsx`
- **Integration**: `src/grid-components/MessagesPanel.tsx`

## Migration Notes

The component was extracted from `MessagesPanel.tsx` (lines 296-356) to:

1. Make it reusable across the app
2. Encapsulate cursor blinking logic
3. Simplify keyboard event handling
4. Remove cursor state management from parent components

### Before (in MessagesPanel)

```tsx
const [cursorVisible, setCursorVisible] = createSignal(true)

// Manual cursor interval in parent
setInterval(() => setCursorVisible(prev => !prev), 500)

// Props included cursorVisible
<MessagesPanel cursorVisible={cursorVisible()} />
```

### After (with TerminalInput)

```tsx
// No cursor state needed in parent
<TerminalInput value={inputText()} onInput={setInputText} onSubmit={handleSubmit} />
```

## Color Scheme

| Element          | Color   | Variable         |
| ---------------- | ------- | ---------------- |
| Background       | #0a0a0a | `--bg-main`      |
| Border           | #2a2a2a | `--border`       |
| Prompt `>`       | #e5c07b | Orange           |
| Cursor `█`       | #d19a66 | Orange (lighter) |
| Input text       | #ffffff | `--text-bright`  |
| Badge background | #d19a66 | Orange (lighter) |
| Badge text       | #000000 | Black            |
| Help text        | #6a6a6a | `--text-muted`   |
| Options text     | #d4d4d4 | `--text-main`    |

## Testing

Run the demo component to test all features:

```bash
# Start dev server
cd packages/opentui-web
npm run dev

# Import and render TerminalInputDemo
import { TerminalInputDemo } from "./examples/TerminalInputDemo"
```

## Future Enhancements

- [ ] Multiline text area support (currently single line)
- [ ] Command history with Up/Down arrows
- [ ] Autocomplete suggestions
- [ ] Syntax highlighting for commands
- [ ] Custom placeholder text support
- [ ] Ctrl+C to clear input
- [ ] Ctrl+L to clear screen (if applicable)
