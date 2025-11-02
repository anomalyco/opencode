# CodeSurf Features

CodeSurf is an enhanced fork of OpenCode with additional UI/UX improvements and workflow optimizations.

## Dual Sidebar System

### Left Sidebar - Sessions
- **Session List**: View all active sessions at a glance
- **Quick Switch**: Click any session to switch instantly
- **Active Indicator**: Current session marked with ▶
- **Toggle**: `Cmd+[` or `Ctrl+[`

### Right Sidebar - Context
- **Tools Tab**: Recently used tools with favorites system
- **Todos Tab**: Active todos for current session
- **Files Tab**: Session file changes with git integration
- **Toggle**: `Cmd+]` or `Ctrl+]`
- **Quick Tab Switch**: Press `1`, `2`, or `3` to switch tabs

## Tool Favorites System

Mark frequently used tools as favorites for quick access:

**How it works:**
- Click ★ next to any tool to cycle through states
- **☆ None** - Regular tool (gray)
- **★ Project** - Favorited for this project (blue)
- **★ Global** - Favorited across all projects (gold)

**Benefits:**
- Favorites appear at top of tools list
- Sorted by: Global → Project → Regular
- Synced via config file
- Persistent across sessions

## Quick Commit Workflow

Commit files directly from the Files tab:

1. **Select Files**: Check boxes next to files to commit
2. **Auto Message**: Click [Auto] for automatic commit message
3. **Custom Message**: Or type your own message
4. **Commit**: Click [Commit] to commit selected files
5. **Status**: Committed files show ✓ indicator

## Session Management

Enhanced session handling:

- **Persistent Session List**: Always visible in left sidebar
- **No Duplicate Titles**: Header hidden when left sidebar visible
- **Quick Navigation**: Single-click session switching
- **Visual Feedback**: Clear indication of active session

## Mouse Support Improvements

Better mouse interaction throughout the TUI:

- **Click Selection**: Click to select text
- **UI Interaction**: Click buttons and elements
- **Scroll Support**: Mouse wheel in message area
- **Input Protection**: Mouse wheel events filtered in prompt
- **Context Actions**: Right-click support

## UI/UX Enhancements

### Session Names
- **No Wrapping**: Session names display on single line
- **Proper Truncation**: Clean ellipsis for long names
- **Readable Width**: Optimized sidebar width (45 chars)

### Visual Polish
- **Clean Headers**: No text corruption or overflow
- **Consistent Spacing**: Proper padding and gaps
- **Height Control**: Fixed height prevents multi-line wrapping

## Keybinds

Additional keybinds for sidebar control:

```json
{
  "sidebar_left_toggle": "cmd+[,ctrl+[",
  "sidebar_right_toggle": "cmd+],ctrl+]",
  "sidebar_both_toggle": "cmd+b,ctrl+b"
}
```

Quick tab switching (when right sidebar is open):
- `1` - Tools tab
- `2` - Todos tab
- `3` - Files tab

## Configuration

All CodeSurf features integrate with existing OpenCode config:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "favorites": {
    "project": ["bash", "read", "write"],
    "global": ["grep", "glob"]
  },
  "keybinds": {
    "sidebar_left_toggle": "cmd+[",
    "sidebar_right_toggle": "cmd+]"
  }
}
```

## Differences from OpenCode

All OpenCode features remain intact. CodeSurf adds:

1. ✨ **Dual sidebar layout** (left + right)
2. ⭐ **Tool favorites system**
3. 📁 **Quick commit workflow**
4. 🖱️ **Enhanced mouse support**
5. 🎨 **Visual polish and bug fixes**

Original OpenCode documentation applies for all base features. CodeSurf-specific features are documented with special callout blocks marked with 🏄 (feature), ⚡ (difference), or ➕ (addition).
