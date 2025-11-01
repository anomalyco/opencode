# Where to Find the Commit Interface

## Location: Right Sidebar → Files Tab

The commit interface is located in the **right sidebar** of the desktop app:

```
┌─────────────────────────────────────────────┐
│  Session Title                              │
│  ┌─────────┬─────────┬─────────┐          │
│  │  MCP/LSP│  Todos  │  Files  │ ← Click  │
│  └─────────┴─────────┴─────────┘          │
│                                             │
│  Modified Files          Select All        │
│  ┌─────────────────────────────────────┐  │
│  │ ☑ src/page.tsx          +10/-5     │  │
│  │ ☐ src/utils.ts           +2/-0     │  │
│  │ ☑ package.json           +1/-1     │  │
│  └─────────────────────────────────────┘  │
│                                             │
│  ┌─────────────────────────────────────┐  │
│  │ Commit message...                   │  │
│  │                                     │  │
│  │                                     │  │
│  └─────────────────────────────────────┘  │
│  ┌─────────┬───────────────────────────┐  │
│  │  Auto   │        Commit             │  │
│  └─────────┴───────────────────────────┘  │
│           2 files selected                 │
└─────────────────────────────────────────────┘
```

## Steps to Access:

1. **Open a session** in the desktop app
2. **Look at the right sidebar** (should be visible by default)
3. **Click the "Files" tab** (third tab, after MCP/LSP and Todos)
4. **See modified files** with checkboxes
5. **Commit UI** appears below the file list

## Features:

- ✅ **Checkboxes** - Click any file to select/deselect
- ✅ **Select All** - Toggle all files at once
- ✅ **Scrolling** - If more than ~10 files, list scrolls
- ✅ **Commit Message** - 3-row textarea
- ✅ **Auto Button** - Generates commit message
- ✅ **Commit Button** - Executes git commit

## Visibility:

The sidebar should show:
- **"Files (N)"** - Where N is the count of modified files
- If N = 0, you'll see "No modified files"
- If N > 0, you'll see the commit interface

## Not Seeing It?

Check:
1. Is the right sidebar visible? (may be collapsed)
2. Are you on the "Files" tab?
3. Do you have modified files in the session?
4. Is the session active/loaded?

## Testing:

1. Make a file change in your project
2. Refresh the desktop app
3. Open or select a session
4. Click "Files" tab
5. You should see the file with checkbox and commit UI

---

**Status:** ✅ Installed and ready to use!
