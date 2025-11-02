# Sidebar Tools Panel Enhancement

The sidebar "MCP/LSP" tab has been renamed to "Tools" and now shows:

## New "Tools" Tab Layout

### 1. **Tools Used** (New!)
Shows the top 10 most-used tools in the current session with usage counts:

```
Tools Used
⚡ cc_bash                    ×12
⚡ cc_edit                    ×8
⚙ bash                       ×5
⚙ read                       ×4
⚡ cc_read                    ×3
⚙ edit                       ×2
```

**Features:**
- ⚡ lightning bolt = Claude Code tools (`cc_` prefix)
- ⚙ gear icon = Standard OpenCode tools
- Shows usage count (×N) for each tool
- Sorted by usage (most used first)
- Limited to top 10 tools
- Auto-updates as session progresses

**Color Coding:**
- Claude Code tools (`cc_*`) = Accent color (highlighted)
- Standard tools = Normal text color
- Usage counts = Muted text color

### 2. **LSP**
Language Server Protocol integrations:

```
LSP
• typescript /path/to/project
• python /another/project
```

**Status Indicators:**
- Green dot (•) = Connected
- Red dot (•) = Error

### 3. **MCP**
Model Context Protocol servers:

```
MCP
▶ exa Connected
▶ github Connected
▼ context7 Connected
  ⚙ read_documentation
  ⚙ search_docs
```

**Features:**
- Click server name to expand/collapse tools
- Shows connection status
- Lists available tools when expanded

## Tab Navigation

```
● Tools(15)    ○ Todos(3)    ○ Files(5)
```

The Tools count now includes:
- Number of unique tools used
- Number of MCP servers
- Number of LSP servers

**Keyboard Shortcuts:**
- Press `1` = Switch to Tools tab
- Press `2` = Switch to Todos tab  
- Press `3` = Switch to Files tab

## Benefits

### For Users
- **Quick Insight**: See which tools Claude is using most
- **Debugging**: Understand agent behavior patterns
- **Performance**: Identify frequently-called tools
- **Visibility**: Track Claude Code tool adoption

### For Developers
- **Analytics**: Monitor tool usage patterns
- **Optimization**: Identify tools that need improvement
- **Testing**: Verify tool integration is working

## Technical Details

The tools tracking:
- Counts completed tool calls from message parts
- Updates in real-time as new messages arrive
- Filters by `status === "completed"` (excludes errors)
- Uses `createMemo` for efficient updates
- No API calls required (uses existing sync data)

## Future Enhancements

Potential additions:
- Click tool name to filter messages showing that tool
- Show average execution time per tool
- Display error rate for each tool
- Export tool usage statistics
- Compare tool usage across sessions
