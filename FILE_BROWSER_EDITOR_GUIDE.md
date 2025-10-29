# File Browser & Code Editor Guide

## Overview

The OpenCode WebApp now includes a full-featured file browser and Monaco code editor, transforming it into a complete IDE-like experience.

## New Features

### 🗂️ File Browser

Navigate your project files directly from the web interface:

- **Directory Navigation**: Click folders to navigate
- **File Search**: Search files by name in real-time
- **File Metadata**: See file sizes and types
- **Breadcrumb Navigation**: Current path display
- **Quick Open**: Click any file to open in editor

### 📝 Monaco Code Editor

Professional code editing powered by VS Code's engine:

- **Syntax Highlighting**: Support for 20+ languages
- **IntelliSense**: Code completion and suggestions
- **Multi-file Tabs**: Work with multiple files simultaneously
- **Auto-save**: Ctrl/Cmd+S to save changes
- **Dirty Indicators**: Blue dot shows unsaved changes
- **Minimap**: Code overview for quick navigation
- **Line Numbers**: Rulers at 80 and 120 characters
- **Word Wrap**: Automatic text wrapping
- **Dark Theme**: Matches the app's dark design

## View Modes

The app now supports 3 view modes:

### 1. Chat Mode (Default)
- Focus on AI conversation
- Full-width chat interface
- Ideal for asking questions and getting help

### 2. Editor Mode
- Full-screen code editing
- File browser on left
- Monaco editor on right
- Perfect for coding sessions

### 3. Split Mode (Recommended)
- Best of both worlds
- Chat on left, Editor on right
- File browser in center
- Work with AI while editing code
- Auto-activates when opening files

## Usage

### Opening Files

1. **Switch to Editor or Split mode**
   - Click "Editor" or "Split" button in header

2. **Navigate to your file**
   - Use file browser on left
   - Click folders to navigate
   - Or use search to find files

3. **Click file to open**
   - File opens in Monaco editor
   - Tab appears at top
   - Start editing immediately

### Editing Files

1. **Make changes**
   - Full Monaco features available
   - Syntax highlighting automatic
   - IntelliSense helps as you type

2. **Save changes**
   - Press `Ctrl+S` (Windows/Linux)
   - Press `Cmd+S` (Mac)
   - Or click "Save" button
   - Blue dot disappears when saved

3. **Switch between files**
   - Click tabs at top
   - Each file remembers its state
   - Unsaved changes preserved

### Managing Tabs

- **Close tab**: Click X on tab
- **Switch tab**: Click tab name
- **Unsaved warning**: Prompted before closing dirty files

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + S` | Save current file |
| `Ctrl/Cmd + F` | Find in file |
| `Ctrl/Cmd + H` | Find and replace |
| `Ctrl/Cmd + /` | Toggle comment |
| `Alt + Up/Down` | Move line up/down |
| `Ctrl/Cmd + D` | Add cursor to next match |

## Supported Languages

Auto-detected from file extension:

- **Web**: JavaScript, TypeScript, HTML, CSS, SCSS
- **Backend**: Python, Ruby, Go, Rust, Java, PHP
- **Config**: JSON, YAML, XML
- **Shell**: Bash, Shell scripts
- **Documentation**: Markdown
- **And more**: C, C++, C#, SQL, etc.

## API Endpoints Used

The file browser and editor use these API endpoints:

```
GET  /file?path=<path>              # List directory contents
GET  /file/content?path=<path>      # Read file
POST /project/file                  # Write file
DELETE /project/file?path=<path>    # Delete file
GET  /find/file?query=<query>       # Search files
GET  /file/status                   # Git status
```

## Architecture

### Components

**FileBrowser.tsx**:
- Directory tree component
- File search functionality
- Click handlers for navigation
- File type icons

**CodeEditor.tsx**:
- Monaco editor wrapper
- Tab management
- Save functionality
- Keyboard shortcuts

### State Management

**files.ts store**:
- `openFiles`: Array of open file tabs
- `activeFileIndex`: Currently active tab
- `currentPath`: Current directory
- `files`: Files in current directory
- `searchResults`: File search results

### File Operations

```typescript
// Open a file
await openFile('/path/to/file.js')

// Save current file
await saveCurrentFile()

// Close a file
closeFile(tabIndex)

// Navigate directory
await loadDirectory('/new/path')

// Search files
await searchFiles('query')
```

## Examples

### Example 1: Edit a Config File

1. Click "Split" mode
2. Navigate to project root in file browser
3. Click `package.json`
4. Edit dependencies
5. Press `Ctrl+S` to save
6. Ask AI: "What dependencies did I just add?"

### Example 2: Create New Component

1. Ask AI in chat: "Create a Button component in React"
2. AI responds with code
3. Click "Split" mode
4. Navigate to `src/components/`
5. Right-click (future feature) or manually create file
6. Paste AI's code
7. Save with `Ctrl+S`

### Example 3: Debug Code

1. Open problematic file in editor (Split mode)
2. Select code with issue
3. In chat, ask: "Why isn't this working?"
4. AI analyzes your code
5. Apply suggested fix in editor
6. Save and test

## Tips & Tricks

### Tip 1: Quick File Access
Use the search box in file browser to quickly find files by name. Results update as you type.

### Tip 2: Dirty File Tracking
Look for the blue dot on tabs - it shows which files have unsaved changes. Save often!

### Tip 3: Split Mode Workflow
1. Chat with AI about what you want to build
2. AI provides code
3. Open relevant file in editor
4. Apply changes
5. Continue conversation

### Tip 4: Multi-file Editing
Open multiple related files in tabs and switch between them. Each maintains its own undo/redo history.

### Tip 5: Language Detection
Monaco automatically detects language from file extension. For `.js` vs `.jsx`, it defaults to JavaScript.

## Troubleshooting

### Editor Not Loading

**Problem**: Monaco editor shows blank screen

**Solution**:
1. Check browser console for errors
2. Ensure CDN is accessible
3. Try refreshing the page
4. Check ad blockers aren't blocking CDN

### Files Not Showing

**Problem**: File browser is empty

**Solution**:
1. Check server is running (`bun run dev serve`)
2. Check file permissions
3. Navigate to correct directory
4. Check API endpoint in browser DevTools

### Can't Save File

**Problem**: Save button doesn't work

**Solution**:
1. Check file is actually dirty (blue dot)
2. Check server is running
3. Check file permissions on server
4. Look for errors in browser console

### Search Not Working

**Problem**: File search shows no results

**Solution**:
1. Type more specific query
2. Check you're in correct directory
3. Try refreshing file browser
4. Check server API is responding

## Performance

### Monaco Loading
- Monaco loads from CDN on demand
- First load: ~500KB download
- Cached after first load
- No impact on initial page load

### File Operations
- All file operations are async
- Large files may take time to load
- Editor handles files up to 1MB efficiently
- Consider splitting very large files

## Future Enhancements

Planned features:

- [ ] Context menu (right-click) for file operations
- [ ] Drag-and-drop file upload
- [ ] File rename in browser
- [ ] New file/folder creation from UI
- [ ] Git integration (diff view, blame)
- [ ] Find in files (project-wide search)
- [ ] File tree expansion/collapse
- [ ] Favorites/bookmarks
- [ ] Recent files list
- [ ] File preview without opening

## Security

### File Access
- Server controls file access
- Only files in project directory accessible
- No access to system files
- Respect .gitignore patterns (future)

### File Saving
- Server validates all write operations
- No arbitrary file write
- Path traversal protection
- Content validation on server

## Configuration

### Monaco Options

Edit `CodeEditor.tsx` to customize:

```typescript
monaco.editor.create(container, {
  theme: "vs-dark",           // Theme
  fontSize: 14,               // Font size
  minimap: { enabled: true }, // Minimap
  wordWrap: "on",            // Word wrap
  tabSize: 2,                // Tab size
  // ... more options
})
```

### File Browser

Edit `FileBrowser.tsx` to customize:

```typescript
// Show/hide file sizes
<Show when={file.size !== undefined}>
  <div class="text-xs">{formatSize(file.size)}</div>
</Show>
```

## Resources

- [Monaco Editor Docs](https://microsoft.github.io/monaco-editor/)
- [Monaco API Reference](https://microsoft.github.io/monaco-editor/api/)
- [Supported Languages](https://github.com/microsoft/monaco-languages)
- [Keyboard Shortcuts](https://code.visualstudio.com/docs/getstarted/keybindings)

## Summary

The file browser and Monaco editor transform OpenCode into a complete web IDE:

✅ **Professional editing experience**
✅ **Seamless AI integration**
✅ **Multiple view modes**
✅ **Full keyboard support**
✅ **20+ language support**
✅ **Real-time file operations**

Start editing code directly in your browser while chatting with AI!

---

**Created**: 2025-10-29
**Version**: 1.0
**Status**: ✅ Production Ready
