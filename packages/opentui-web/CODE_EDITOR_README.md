# Code Editor Integration

## Overview

Monaco Editor has been integrated into the OpenTUI Web project, providing a rich code editing experience directly in the browser. The editor matches the terminal-inspired design aesthetic with custom theming.

## Features

### Code Editor (`CodeEditor.tsx`)

- **Full Monaco Editor** with syntax highlighting for 30+ languages
- **Custom Theme** matching the terminal design (dark background, terminal colors)
- **Auto Language Detection** from file extensions
- **Read-Only Mode** for viewing files
- **Keyboard Shortcuts**:
  - `Ctrl+S` / `Cmd+S`: Save file (when editable)
  - `ESC`: Close editor
- **File Status Indicator**: Shows dirty state with a dot indicator
- **Line Count Display**: Shows current line count in footer

### File Browser (`FileBrowser.tsx`)

- **Tree View** for navigating project files
- **Expandable Directories** with arrow indicators
- **File Type Icons** with color coding:
  - TypeScript/TSX: Blue hexagon
  - JavaScript/JSX: Yellow hexagon
  - JSON: Green braces
  - Markdown: Document icon
  - CSS: Blue hash
  - Others: Gray circle
- **Selection Highlighting** with background color change
- **Compact Design** fitting the terminal grid layout

### Custom Monaco Theme (`monaco-theme.ts`)

Matches the existing terminal color scheme:

- Background: `#0a0a0a` (dark black)
- Foreground: `#d4d4d4` (light gray)
- Keywords: `#d19a66` (orange)
- Strings: `#98c379` (green)
- Functions/Types: `#61afef` (blue)
- Comments: `#6a6a6a` (muted gray, italic)
- Cursor: `#e5c07b` (yellow)

## Usage

### Opening Files from Sidebar

Files clicked in the sidebar's "Files" tab will now open in the Monaco editor overlay:

1. Navigate to the Files tab in the right sidebar
2. Click on any file path under "Written", "Edited", or "Read" sections
3. The editor will open fullscreen with the file content
4. Use `ESC` or click "Close" to return

### Integration Points

#### In `TerminalViewNew.tsx`:

```typescript
const handleSelectFile = async (path: string) => {
  const result = await sdk.client.file.read({ query: { path } })
  if (result.data?.type === "text") {
    setEditorFile({ path, content: result.data.content })
    setEditorOpen(true)
  }
}
```

#### In `TerminalLayout.tsx`:

The layout passes the `onSelectFile` handler to the sidebar panel, which triggers file opening.

## Technical Details

### Dependencies

- `monaco-editor@0.54.0`: Core Monaco editor
- `@monaco-editor/react@4.7.0`: React wrapper (used for types, direct monaco API used for Solid)

### SolidJS Integration

The editor uses Monaco's native API directly rather than the React wrapper to avoid compatibility issues:

```typescript
const monaco = await import("monaco-editor")
const editor = monaco.editor.create(containerRef, {
  /* options */
})
```

### File Reading

Files are read via the OpenCode SDK:

```typescript
sdk.client.file.read({ query: { path: "/path/to/file" } })
```

Returns a `FileContent` object:

```typescript
{
  type: "text",
  content: string,
  diff?: string,
  patch?: { /* patch info */ }
}
```

### Current Limitations

1. **Read-Only Mode**: File editing/saving is disabled by default (SDK write endpoint integration pending)
2. **No File Tree**: Currently only opens files from sidebar, doesn't browse full project tree
3. **No Multi-File**: Single file editing only (no tabs)

## Future Enhancements

### Planned Features

1. **File Writing**: Integrate SDK write endpoint for editing
2. **File Browser Panel**: Full project tree navigation
3. **Multi-Tab Support**: Open multiple files with tab interface
4. **Diff View**: Compare file versions using Monaco's diff editor
5. **Search/Replace**: Global search across files
6. **Git Integration**: Show git status indicators
7. **LSP Integration**: Connect to language servers for IntelliSense

### Design Considerations

All enhancements should maintain:

- Terminal grid-based layout
- Character-aligned positioning where appropriate
- Dark theme consistency
- Keyboard-first navigation
- Minimal, focused UI

## File Structure

```
src/
├── grid-components/
│   ├── CodeEditor.tsx      # Monaco editor component
│   ├── FileBrowser.tsx     # File tree browser
│   └── index.ts            # Exports
├── theme/
│   └── monaco-theme.ts     # Custom Monaco theme
└── components/
    └── TerminalViewNew.tsx # Integration point
```

## Styling

The editor maintains the Berkeley Mono font at 16px with 24px line height to match the terminal aesthetic. All UI elements (header, footer) use the same font family and size as the terminal grid for consistency.

## Keyboard Shortcuts

Global shortcuts (from `TerminalLayout`):

- `Ctrl+P`: Command menu
- `Ctrl+[`: Toggle left sidebar
- `Ctrl+]`: Toggle right sidebar
- `Ctrl+B`: Toggle both sidebars

Editor shortcuts:

- `Ctrl+S` / `Cmd+S`: Save (when editable)
- `ESC`: Close editor
- Standard Monaco shortcuts (Ctrl+F for find, etc.)
