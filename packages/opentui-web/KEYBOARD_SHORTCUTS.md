# Keyboard Shortcuts

OpenTUI Web supports the following keyboard shortcuts for efficient navigation and control.

## Global Shortcuts

These shortcuts work throughout the application:

| Shortcut | Action          | Description                                     |
| -------- | --------------- | ----------------------------------------------- |
| `Ctrl+P` | Command Menu    | Open the command palette to access all commands |
| `Ctrl+N` | New Chat        | Create a new chat session                       |
| `Ctrl+L` | Clear Screen    | Scroll to bottom of messages                    |
| `Ctrl+S` | Toggle Sidebar  | Show/hide the right sidebar (todos & subagents) |
| `Ctrl+B` | Toggle Sessions | Show/hide the left sessions panel               |
| `Esc`    | Cancel/Close    | Close open dialogs (command menu, etc.)         |

## Input Field Shortcuts

When typing in the message input:

| Shortcut      | Action       |
| ------------- | ------------ |
| `Enter`       | Send message |
| `Shift+Enter` | New line     |

## Command Menu Navigation

When the command menu is open (Ctrl+P):

| Shortcut       | Action                   |
| -------------- | ------------------------ |
| `↑/↓`          | Navigate commands        |
| `Enter`        | Execute selected command |
| `Esc`          | Close menu               |
| Type to search | Filter commands          |

## Implementation

The keyboard shortcut system is implemented using:

- **Utility**: `/src/utils/keyboard.ts` - Core keyboard handler with modifier key detection
- **Integration**: `/src/grid-components/TerminalLayout.tsx` - Global shortcut registration
- **Non-interference**: Shortcuts don't interfere with text input in textarea/input elements

### Adding New Shortcuts

To add a new keyboard shortcut, edit `TerminalLayout.tsx` and add to the `shortcuts` array:

```typescript
{
  key: "k",
  ctrl: true,
  description: "Your action description",
  action: yourHandlerFunction,
}
```

### Keyboard Handler Features

- **Modifier keys**: Support for Ctrl, Shift, Alt, Meta
- **Input protection**: Automatically prevents interference with textarea/input typing
- **Exception handling**: ESC key works even in input fields
- **Cross-platform**: Handles both Ctrl (Windows/Linux) and Cmd (Mac) automatically

## Notes

- On macOS, `Ctrl` shortcuts also work with `Cmd` key
- Shortcuts are case-insensitive
- Visual hints for available shortcuts appear in the footer bar
- All shortcuts are also accessible via the Command Menu (Ctrl+P)
