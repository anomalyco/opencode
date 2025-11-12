# TUI File Viewer & Browser

Terminal-based file viewing and browsing integrated into OpenCode's TUI (Terminal User Interface).

## Features

### 🔍 File Viewer (`component/file-viewer.tsx`)

A full-featured terminal-based file viewer with syntax highlighting and keyboard navigation.

**Features:**

- **Syntax-aware coloring** for TypeScript, JavaScript, Python, Go, Rust, and more
- **Line numbers** with auto-sizing
- **Keyboard navigation**:
  - `↑/↓` or `j/k`: Scroll line by line
  - `PgUp/PgDn` or `Ctrl+B/F`: Jump by page
  - `Home/End` or `g/G`: Jump to top/bottom
  - `ESC`: Close viewer
- **Mouse wheel support**: Scroll with mouse
- **Status bar**: Shows current line range, total lines, scroll percentage
- **Help hints**: Always visible keyboard shortcuts
- **File info**: Language detection, line count, file path

**Color Scheme:**

- Keywords: Theme primary color (blue)
- Comments: Muted gray
- Strings: Success green
- Regular text: Theme text color

### 📂 File Browser (`component/file-browser.tsx`)

Tree-based file navigation for browsing project files.

**Features:**

- **Tree view** with expandable directories
- **File type icons**:
  - Directories: `▶`/`▼` (collapsed/expanded)
  - TypeScript: `⬢` (blue hexagon)
  - JavaScript: `◆` (yellow diamond)
  - JSON: `{}` (green braces)
  - Markdown: `□` (white square)
  - CSS: `#` (hash symbol)
  - Other: `•` (bullet)
- **Keyboard navigation**:
  - `↑/↓` or `j/k`: Navigate files
  - `←/→` or `h/l`: Collapse/expand directories
  - `Enter`: Open file or toggle directory
  - `ESC`: Close browser
- **Mouse support**: Click to navigate and open
- **Visual selection**: Highlighted current item
- **Color coding** by file type

## Integration

### Sidebar Files Tab

Click any file in the sidebar's "Files" tab to open it in the viewer:

```tsx
// In sidebar.tsx
onMouseUp={async () => {
  const { FileViewer } = await import("../../component/file-viewer")
  dialog.replace(() => <FileViewer filePath={item.file} onClose={() => dialog.clear()} />)
}}
```

### Command Palette

Access file browser from command palette (`Ctrl+P`):

```
Browse files → Opens file browser
  ↓ Navigate and select file
  ↓ Opens in file viewer
```

The command is registered in `app.tsx`:

```tsx
{
  title: "Browse files",
  value: "files.browse",
  keybind: "files_browse",
  category: "Files",
  onSelect: async () => {
    // Opens FileBrowser → FileViewer on selection
  }
}
```

## Technical Details

### File Reading

Files are read via the OpenCode SDK:

```typescript
const result = await sdk.client.file.read({
  query: { path: filePath },
})
```

Returns `FileContent`:

```typescript
{
  type: "text",
  content: string,
  diff?: string,
  patch?: { /* ... */ }
}
```

### File Listing

Directory contents fetched via:

```typescript
const result = await sdk.client.file.list({
  query: {
    directory: ".",
    path: ".",
  },
})
```

Returns array of `FileNode` objects with name, path, and type.

### Theme Integration

Components use the TUI theme system:

```typescript
const { theme } = useTheme()

// Available colors:
theme.background // Main background
theme.backgroundPanel // Panel background
theme.backgroundElement // Element background
theme.text // Primary text
theme.textMuted // Muted text
theme.primary // Primary accent (keywords)
theme.secondary // Secondary accent (directories)
theme.accent // Accent color (JavaScript)
theme.success // Success color (strings, JSON)
theme.error // Error color (close button)
theme.warning // Warning color
theme.diffAdded // Git diff added
theme.diffRemoved // Git diff removed
```

### Keyboard Handling

Uses OpenTUI's `useKeyboard` hook:

```typescript
useKeyboard((evt) => {
  if (evt.name === "escape") {
    props.onClose()
  }
  // ... more handlers
})
```

Supports:

- Named keys: `"up"`, `"down"`, `"escape"`, `"return"`, etc.
- Vi-style: `"j"`, `"k"`, `"h"`, `"l"`, `"g"`, `"G"`
- Special: `evt.ctrl`, `evt.shift`, `evt.meta`

## Usage Examples

### 1. View File from Sidebar

1. Navigate to session view
2. Click right sidebar "Files" tab
3. Click any modified file
4. File opens in full-screen viewer
5. Press `ESC` to close

### 2. Browse Project Files

1. Press `Ctrl+P` to open command palette
2. Type "browse" and select "Browse files"
3. Navigate with `↑↓` or `jk`
4. Press `Enter` to open selected file
5. Press `ESC` to go back to browser
6. Press `ESC` again to close

### 3. Quick Navigation in Viewer

```
g       → Jump to top of file
G       → Jump to bottom of file
PgDn    → Jump down one page
PgUp    → Jump up one page
j/↓     → Scroll down one line
k/↑     → Scroll up one line
ESC     → Close viewer
```

## Syntax Highlighting

Basic keyword-based highlighting for common languages:

**Supported:**

- TypeScript/TSX
- JavaScript/JSX
- Python
- Go
- Rust

**Detection:**

- Keywords (const, let, function, class, etc.) → Primary color
- Comments (// or #) → Muted
- Strings ("", '', ``) → Success green

**Enhancement Opportunities:**

- Add more language patterns
- Integrate with LSP for semantic highlighting
- Add regex pattern highlighting
- Support ANSI color codes in output

## File Structure

```
src/cli/cmd/tui/
├── component/
│   ├── file-viewer.tsx      # Full-screen file viewer
│   └── file-browser.tsx     # Tree-based file navigator
├── routes/session/
│   └── sidebar.tsx          # Modified to add file click handlers
└── app.tsx                  # Modified to add browse command
```

## Future Enhancements

### Planned Features

1. **Advanced Syntax Highlighting**
   - LSP-based semantic highlighting
   - Tree-sitter integration
   - More language support

2. **Search & Filter**
   - Search within file (Ctrl+F)
   - Search across files (ripgrep integration)
   - Filter files in browser

3. **Diff View**
   - Side-by-side diff display
   - Inline diff markers
   - Git integration

4. **File Operations**
   - Create new file
   - Delete file
   - Rename file
   - Copy/move file

5. **Editor Mode**
   - Basic editing capabilities
   - Save changes
   - Undo/redo

6. **Bookmarks & History**
   - Recent files list
   - Bookmarked files
   - Jump to definition

7. **Performance**
   - Virtual scrolling for huge files
   - Lazy loading file tree
   - Streaming for large files

## Keyboard Reference

### File Viewer

| Key                             | Action              |
| ------------------------------- | ------------------- |
| `↑` `↓` `j` `k`                 | Scroll line by line |
| `PgUp` `PgDn` `Ctrl+B` `Ctrl+F` | Page up/down        |
| `Home` `End` `g` `G`            | Jump to top/bottom  |
| `ESC`                           | Close viewer        |

### File Browser

| Key             | Action                     |
| --------------- | -------------------------- |
| `↑` `↓` `j` `k` | Navigate items             |
| `←` `→` `h` `l` | Collapse/expand directory  |
| `Enter`         | Open file/toggle directory |
| `ESC`           | Close browser              |

## Design Principles

1. **Vim-like Navigation**: Familiar keyboard shortcuts (hjkl, gg, G)
2. **Mouse Support**: Click to interact for accessibility
3. **Theme Consistency**: Uses TUI theme colors throughout
4. **Minimal UI**: Clean, focused interface
5. **Keyboard First**: All actions accessible via keyboard
6. **Context Awareness**: Shows relevant info (line numbers, %, language)

## Performance Notes

- **Large Files**: Currently loads entire file into memory
  - Consider implementing virtual scrolling for files > 10,000 lines
  - Add streaming support for huge files
- **File Tree**: Loads full directory listing at once
  - Consider lazy loading for directories with many files
  - Add pagination for large directories

- **Rendering**: OpenTUI handles efficient terminal rendering
  - Only visible lines are rendered
  - Smooth 60 FPS updates

## Troubleshooting

**File won't open:**

- Check file permissions
- Verify file path is correct
- Check SDK connection (`server:PORT` in sidebar)

**Syntax highlighting not working:**

- File extension detection is case-insensitive
- Only basic highlighting is implemented
- Check file has recognized extension

**Keyboard shortcuts not responding:**

- Ensure terminal supports keypress events
- Check for conflicting terminal keybindings
- Try mouse interaction as fallback

**Performance issues with large files:**

- Files > 10,000 lines may be slow
- Consider using external editor for huge files
- Future: virtual scrolling will fix this
