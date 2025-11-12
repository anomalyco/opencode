# Vim-Style Terminal Code Editor (Experimental)

## Status: DISABLED BY DEFAULT

The vim-style terminal code editor has been **disabled by default** because it requires vim knowledge to use effectively.

## What Was Built

A full-featured vim-style code editor in the terminal with:

✅ **Vim Modes:**

- NORMAL - Navigation and commands
- INSERT - Text editing
- VISUAL - Selection
- COMMAND - Ex commands (`:w`, `:q`, etc.)

✅ **Vim Keybindings:**

- Movement: `hjkl`, `w`, `b`, `0`, `$`, `gg`, `G`
- Insert: `i`, `I`, `a`, `A`, `o`, `O`
- Delete: `x`, `dd`
- Commands: `:w` (save), `:q` (quit), `:wq` (save & quit)

✅ **Features:**

- Syntax highlighting
- Line numbers
- File saving to disk
- Keyboard event blocking (no passthrough)
- Dirty state tracking
- Auto-scrolling

## Issues

❌ **Requires vim expertise** - Not user-friendly for non-vim users
❌ **Complex modal editing** - Easy to get stuck in wrong mode
❌ **No visual feedback** for mode changes (besides status line)

## How to Enable

If you want to use the vim editor, uncomment these lines in:

```
packages/opencode/src/cli/cmd/tui/app.tsx
Lines 285-320
```

Remove the `//` comments from the two command definitions:

- "Browse files (vim editor)"
- "Open file in editor (vim)"

Then restart the TUI:

```bash
cd packages/opencode
bun dev
```

## Files

```
packages/opencode/src/cli/cmd/tui/component/
├── code-editor.tsx           Full vim implementation
├── file-browser.tsx          File tree navigator
└── file-viewer.tsx           Read-only viewer (simpler alternative)
```

## Alternative

For viewing files without editing:

1. Click files in sidebar "Files" tab
2. Opens read-only `FileViewer` component
3. No vim, just scroll with arrows/page keys
4. ESC to close

## Recommendation

**Keep it disabled** unless you:

- Are comfortable with vim
- Need in-terminal editing
- Want to contribute improvements

For most users, the AI can edit files via tools - no manual editing needed!

## Future Ideas

- Add a **normal text editor mode** (no vim)
- Use TextareaRenderable for simpler editing
- Or just rely on external editor integration (already exists with `<leader>e`)
