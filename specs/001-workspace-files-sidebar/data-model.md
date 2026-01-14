# Data Model: Workspace Files Sidebar

**Feature**: 001-workspace-files-sidebar
**Date**: 2026-01-14

## Overview

This feature extends the existing layout state model to manage secondary sidebar visibility and dimensions. It leverages existing file system data models from the Local context.

---

## Entities

### 1. WorkspaceSidebarState

**Purpose**: Persisted UI state for the secondary sidebar

**Fields**:
| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| opened | boolean | Yes | false | Whether sidebar is visible |
| width | number | Yes | 300 | Sidebar width in pixels |

**Validation Rules**:
- `width` must be between 200 and 600 pixels (40% of typical viewport)
- `opened` defaults to false on first launch

**Persistence**:
- Stored in layout context with key `workspaceSidebar`
- Versioned with layout schema (increment to `layout.v7`)
- Auto-persisted via `persisted()` utility

---

### 2. LocalFile (Existing)

**Purpose**: Represents a file or directory in the workspace

**Fields**:
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| path | string | Yes | Absolute file path |
| name | string | Yes | File/folder name (basename) |
| type | "file" \| "directory" | Yes | Node type |
| ignored | boolean | No | Whether file is gitignored |

**Source**: `packages/app/src/context/local.tsx`

**Relationships**:
- Directory nodes contain child LocalFile nodes
- Expansion state managed separately in Local context

---

### 3. FileTypeCategory (Conceptual)

**Purpose**: Classification for icon mapping

**Categories**:
| Category | Extensions |
|----------|------------|
| document | pdf, doc, docx, txt, rtf, odt |
| markdown | md, mdx |
| image | png, jpg, jpeg, gif, svg, webp, ico |
| code | ts, tsx, js, jsx, py, rs, go, java, html, css, json, yaml |
| archive | zip, tar, gz, rar, 7z |
| media | mp3, mp4, wav, avi, mov |
| folder | (directories) |
| unknown | (fallback for unrecognized extensions) |

**Implementation**: Handled by `FileIcon` component's `chooseIconName()` function

---

## State Transitions

### Sidebar Visibility

```
[Hidden] --toggle()--> [Visible]
[Visible] --toggle()--> [Hidden]
[Visible] --close()--> [Hidden]
[Hidden] --open()--> [Visible]
```

**Triggers**:
- User clicks toggle button in toolbar
- User presses keyboard shortcut (mod+shift+e)
- User clicks close button in sidebar header

### Directory Expansion

```
[Collapsed] --expand(path)--> [Expanded]
[Expanded] --collapse(path)--> [Collapsed]
```

**Triggers**:
- User clicks chevron icon
- User presses ArrowRight (expand) / ArrowLeft (collapse)
- User clicks on directory name

### File Selection

```
[Unselected] --click(file)--> [Selected]
[Selected] --click(otherFile)--> [Unselected] --> [Selected(otherFile)]
[Selected] --Escape--> [Unselected]
```

**Triggers**:
- User single-clicks on file
- User navigates with arrow keys + Enter
- Escape key clears selection

---

## Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                     Layout Context                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ store.workspaceSidebar: WorkspaceSidebarState       │   │
│  │   ├── opened: boolean                                │   │
│  │   └── width: number                                  │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                  │
│                           ▼                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ persisted() utility --> localStorage                │   │
│  │   Key: "layout.v7"                                  │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                      Local Context                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ file.children(path): LocalFile[]                    │   │
│  │   Returns immediate children of directory           │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                  │
│                           ▼                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ FileTree Component                                  │   │
│  │   ├── Recursive rendering                           │   │
│  │   ├── Collapsible directories                       │   │
│  │   └── FileIcon per node                             │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## Schema Migration

**From**: `layout.v6` (current)
**To**: `layout.v7` (with workspaceSidebar)

**Migration Logic**:
```typescript
migrate: (old: LayoutV6) => ({
  ...old,
  workspaceSidebar: {
    opened: false,
    width: 300,
  },
})
```

**Backward Compatibility**: Existing layout preferences preserved; new workspaceSidebar initialized with defaults.

---

## Indexes / Performance Considerations

| Operation | Complexity | Notes |
|-----------|------------|-------|
| Get children | O(1) | Local context caches file tree |
| Toggle expand | O(1) | Store update |
| Render tree | O(n) | n = visible files; collapsed dirs skip children |
| Search/filter | N/A | Not in scope for v1 |

**Large Directory Handling**:
- Lazy expansion: Children loaded on demand when folder expanded
- Virtualization available via `virtua` library if performance degrades
- Recommended threshold: 1000 files before considering virtualization
