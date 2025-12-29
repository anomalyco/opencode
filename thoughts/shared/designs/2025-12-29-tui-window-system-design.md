---
date: 2025-12-29
topic: "TUI Window System"
status: validated
---

# TUI Window System Design

## Problem Statement

The current TUI has a fixed layout - header, messages, sidebar, footer. Users want:

- A more compact interface with less padding
- Ability to hide UI elements they don't use
- A NERDTree-style session explorer
- General extensibility for custom views

The goal is a Vim-like window system where plugins can create splits, render views, and users have full control over their layout.

## Constraints

- Must work within the existing `@opentui/solid` rendering system
- Chat session view remains built-in (not plugin-replaceable)
- Plugins should be simple to write (data-driven, not SolidJS components)
- Vim-style keybinds and behavior where applicable

## Approach

Adopt Vim's model: provide primitives (windows, splits, buffers) and let plugins compose them imperatively. Unlike Vim's raw text buffers, we use typed view primitives (tree, list, text, form) to keep plugin authoring simple.

## Architecture

### Core Primitives

**View**
Content that can be displayed in a window. Two categories:

- Built-in: `session`, `home`
- Plugin-provided: uses typed primitives (tree, list, text, form)

**Window**
A rectangular area displaying a single view. Properties:

- Dimensions (managed by parent split)
- Focus state
- Border styling
- View reference

**Split**
A container dividing space between children. Properties:

- Direction: horizontal or vertical
- Children: windows or nested splits
- Size ratios

**Float**
A window with absolute positioning, rendered above the layout. Used for dialogs, popups, command palette.

**Layout**
The root container:

- A tree of splits and windows
- A list of floats
- Tracks which window has focus

### Layout Structure

```
Layout
├── Split (vertical)
│   ├── Window [view: session-tree, width: 30]
│   └── Split (horizontal)
│       ├── Window [view: session, focused]
│       └── Window [view: file-preview]
└── Floats
    └── Float [view: command-palette]
```

## Components

### View Primitives (for plugins)

**Tree**
Hierarchical navigation (session explorer, file browser).

- Nodes with label, icon, children
- Expand/collapse state
- Actions: select, delete, rename

**List**
Flat searchable items (command palette, session list).

- Items with label, description, metadata
- Fuzzy search
- Actions: select

**Text**
Read-only styled content (logs, previews, help).

- Lines with styling
- Scrollable

**Form**
Settings and input (preferences panel).

- Field types: text, toggle, select, number
- Validation
- Submit action

### Built-in Views

**session**
The chat interface. Not replaceable by plugins. Renders messages, tool outputs, prompt input.

**home**
Welcome screen shown on startup or when no session is active.

### Window Commands

Prefix: `<C-w>` (Vim-style)

| Key       | Action                          |
| --------- | ------------------------------- |
| `h/j/k/l` | Focus window left/down/up/right |
| `s`       | Split horizontal                |
| `v`       | Split vertical                  |
| `c`       | Close window                    |
| `o`       | Close all other windows         |
| `=`       | Equalize window sizes           |
| `+/-`     | Increase/decrease height        |
| `</>`     | Increase/decrease width         |

Closing the last window exits OpenCode.

### Opening Views

Views are opened via keybinds. Each view can define:

- Default keybind (e.g., `<leader>e` for explorer)
- Default position (e.g., left split, 30 chars wide)

Opening behavior follows Vim:

- Default position is per-view (explorer opens as left split)
- User can override with explicit split commands (`<C-w>v` then open)

### Plugin API

Plugins get imperative access to primitives:

**Window operations**

- Create split (direction, size)
- Close window
- Focus window
- Get current window
- Get all windows

**Rendering**

- Render tree/list/text/form into a window
- Update content reactively

**Keybinds**

- Register global keybind
- Register window-local keybind

**Events**

- Session created/changed/deleted
- Window focused/closed
- Existing event system

Example: A session-tree plugin would:

1. Register a global keybind (`<leader>e`)
2. On keypress, create a left split (30 chars)
3. Render a tree with session data
4. Set up local keybinds for navigation, delete, rename

## Data Flow

1. User presses keybind (e.g., `<leader>e`)
2. Plugin receives keybind event
3. Plugin calls `createSplit({ direction: "left", size: 30 })`
4. Plugin calls `render(window, { type: "tree", data: sessions })`
5. Layout manager updates split tree
6. Renderer draws new layout
7. User navigates tree, plugin receives selection events
8. Plugin calls `openSession(id)`, which opens session view in main window

## Configuration

### Component Visibility and Spacing

Nested by component under `tui`:

```yaml
tui:
  # Existing options
  scroll_speed: number
  scroll_acceleration:
    enabled: boolean
  diff_style: "auto" | "stacked"

  # New component options
  messages:
    padding: number
    gap: number
  sidebar:
    padding: number
    width: number
    visible: boolean
  header:
    padding: number
    visible: boolean
  footer:
    padding: number
    visible: boolean
  prompt:
    padding: number
  window:
    padding: number
    border: boolean
```

### Granular Visibility Toggles

Individual elements can be shown/hidden:

```yaml
tui:
  header:
    visible: boolean
    show_title: boolean
    show_context: boolean
    show_cost: boolean
    show_tokens: boolean
  footer:
    visible: boolean
    show_directory: boolean
    show_lsp_status: boolean
    show_mcp_status: boolean
    show_version: boolean
    show_keybind_hints: boolean
```

## Error Handling

- Invalid split operations (e.g., close last window) exit gracefully
- Plugin render errors show error state in window, don't crash TUI
- Invalid config values fall back to defaults with warning

## Testing Strategy

- Unit tests for layout tree manipulation (split, close, resize)
- Unit tests for focus navigation logic
- Integration tests for plugin view rendering
- Snapshot tests for layout configurations
- Manual testing for keyboard navigation feel

## Open Questions

None - design validated through discussion.
