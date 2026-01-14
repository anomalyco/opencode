# Research: Workspace Files Sidebar

**Feature**: 001-workspace-files-sidebar
**Date**: 2026-01-14

## Executive Summary

All technical unknowns resolved. The feature can leverage existing patterns and components with minimal new code.

---

## Research Findings

### 1. Sidebar State Management & Persistence

**Decision**: Use existing `persisted()` utility with layout context pattern

**Rationale**: The primary sidebar uses this exact pattern for toggle state and width persistence. Adding a parallel `workspaceSidebar` property ensures consistency and automatic localStorage persistence.

**Alternatives Considered**:
- Separate storage key: Rejected - adds complexity, existing layout context handles all sidebar state
- React-style useState: N/A - project uses Solid.js stores

**Implementation Pattern**:
```typescript
// In layout.tsx context store
workspaceSidebar: {
  opened: false,
  width: 300,
}

// API exposed
workspaceSidebar: {
  opened: createMemo(() => store.workspaceSidebar.opened),
  toggle() { setStore("workspaceSidebar", "opened", (x) => !x) },
  width: createMemo(() => store.workspaceSidebar.width),
  resize(width: number) { setStore("workspaceSidebar", "width", width) },
}
```

**Key Files**:
- `packages/app/src/context/layout.tsx` - State definition and API
- `packages/app/src/utils/persist.ts` - Persistence utility

---

### 2. File Tree Component Reuse

**Decision**: Reuse existing `FileTree` component from `packages/app/src/components/file-tree.tsx`

**Rationale**: Existing component provides all required functionality:
- Recursive directory rendering
- Collapsible folders via Kobalte `<Collapsible>`
- Tooltip for full paths (2-second delay)
- File click callback
- Integration with `useLocal()` context for file data

**Alternatives Considered**:
- Build new file tree: Rejected - duplicates existing functionality
- Use generic list component: Rejected - lacks recursive tree structure

**Component Props**:
```typescript
interface FileTreeProps {
  path: string                              // Root directory path
  class?: string                            // Container classes
  nodeClass?: string                        // Per-node classes
  level?: number                            // Nesting depth (internal)
  onFileClick?: (file: LocalFile) => void   // Selection callback
}
```

**Key Files**:
- `packages/app/src/components/file-tree.tsx` - Main component
- `packages/app/src/context/local.tsx` - File system data provider

---

### 3. File Icon System

**Decision**: Use existing `FileIcon` component from `packages/ui/src/components/file-icon.tsx`

**Rationale**: Comprehensive icon coverage already exists:
- 100+ file extensions mapped (ts, tsx, js, py, rs, go, pdf, md, etc.)
- 100+ folder names recognized (src, lib, components, node_modules, etc.)
- SVG sprite system with optimized rendering
- Folder expanded/collapsed state support

**Supported Categories** (per FR-004):
| Category | Extensions Covered |
|----------|-------------------|
| Documents | pdf, doc, docx, txt, rtf, odt |
| Markdown | md, mdx, markdown |
| Images | png, jpg, jpeg, gif, svg, webp, ico, bmp, tiff |
| Code | ts, tsx, js, jsx, py, rs, go, java, html, css, json, yaml |
| Archives | zip, tar, gz, rar, 7z |
| Media | mp3, mp4, wav, avi, mov, webm, flac |

**Alternatives Considered**:
- External icon library: Rejected - existing sprite optimized for bundle size
- Emoji-based icons: Rejected - inconsistent rendering across platforms

**Usage**:
```typescript
<FileIcon
  node={{ path: "example.pdf", type: "file" }}
  class="w-4 h-4"
/>
```

**Key Files**:
- `packages/ui/src/components/file-icon.tsx` - Component
- `packages/ui/public/file-icons/sprite.svg` - Icon sprite

---

### 4. Layout Integration

**Decision**: Add secondary sidebar to right side of main layout, following existing panel patterns

**Rationale**: Session page already has right-side panels (Review, Context) with:
- ResizeHandle for drag-to-resize
- Conditional rendering based on toggle state
- Border and flex layout integration

**Alternatives Considered**:
- Modal/overlay approach: Rejected - spec requires persistent sidebar, not modal
- Tab within existing right panel: Rejected - spec requires dedicated secondary sidebar

**Layout Structure**:
```
┌─────────────────────────────────────────────────────────────┐
│                         Header                              │
├──────────┬─────────────────────────────┬───────────────────┤
│ Primary  │        Main Content          │ Workspace Sidebar │
│ Sidebar  │                              │   (Right side)    │
│  (Left)  │                              │                   │
│          │                              │   ├── Header      │
│          │                              │   └── FileTree    │
└──────────┴─────────────────────────────┴───────────────────┘
```

**Key Files**:
- `packages/app/src/pages/layout.tsx` - Main layout integration
- `packages/app/src/pages/session.tsx` - Right-panel patterns (ResizeHandle, toggle)

---

### 5. Keyboard Navigation

**Decision**: Implement file tree keyboard navigation using existing `useFilteredList` hook pattern

**Rationale**: Existing list components use this pattern for:
- Arrow key navigation (up/down)
- Enter for selection
- Escape for deselect
- Auto-scroll active item into view

**Additional Keys for Tree**:
- ArrowRight: Expand folder
- ArrowLeft: Collapse folder (or move to parent)

**Alternatives Considered**:
- Custom key handler: Rejected - hook provides consistent behavior
- No keyboard support: Rejected - accessibility requirement (FR-015)

**Pattern**:
```typescript
const { active, setActive, onKeyDown } = useFilteredList({
  items: () => flattenedFiles,
  key: (file) => file.path,
  onSelect: (file) => props.onFileClick?.(file),
})
```

**Key Files**:
- `packages/ui/src/hooks/use-filtered-list.tsx` - Navigation hook
- `packages/ui/src/components/list.tsx` - Reference implementation

---

### 6. Command Registration (Toggle Shortcut)

**Decision**: Register toggle command with `mod+shift+e` keybind (mirror of project explorer pattern)

**Rationale**: Follows existing command patterns:
- Commands centralized via `command.register()`
- Keybinds use standard modifier notation
- Commands appear in command palette

**Alternatives Considered**:
- `mod+shift+w`: Could conflict with "close window" on some platforms
- `mod+b`: Reserved for primary sidebar toggle
- No keybind: Rejected - SC-004 requires single-action toggle

**Registration**:
```typescript
command.register(() => [
  {
    id: "workspaceSidebar.toggle",
    title: "Toggle workspace files",
    category: "View",
    keybind: "mod+shift+e",
    onSelect: () => layout.workspaceSidebar.toggle(),
  },
])
```

**Key Files**:
- `packages/app/src/context/command.tsx` - Command system

---

### 7. Mobile/Responsive Behavior

**Decision**: Hide secondary sidebar below XL breakpoint, consistent with primary sidebar

**Rationale**:
- Primary sidebar uses `xl:block` / `xl:hidden` breakpoint
- Mobile devices have limited screen real estate
- Future: Could add modal overlay (like mobile sidebar) if needed

**Alternatives Considered**:
- Different breakpoint: Rejected - consistency with primary sidebar
- Always show on tablet: Rejected - reduces content area significantly

**CSS Pattern**:
```typescript
<div class="hidden xl:block border-l ...">
  {/* Workspace sidebar content */}
</div>
```

---

## Dependencies Confirmed

| Dependency | Status | Notes |
|------------|--------|-------|
| FileTree component | Exists | packages/app/src/components/file-tree.tsx |
| FileIcon component | Exists | packages/ui/src/components/file-icon.tsx |
| Layout context | Exists | packages/app/src/context/layout.tsx |
| Persist utility | Exists | packages/app/src/utils/persist.ts |
| ResizeHandle | Exists | packages/ui/src/components/resize-handle.tsx |
| Collapsible | Exists | @kobalte/core |
| Tooltip | Exists | packages/ui/src/components/tooltip.tsx |
| useFilteredList | Exists | packages/ui/src/hooks/use-filtered-list.tsx |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Performance with 1000+ files | Medium | Medium | Use existing FileTree with lazy loading; virtua available if needed |
| Layout conflicts on resize | Low | Low | Follow existing ResizeHandle patterns with min/max constraints |
| FileIcon missing types | Low | Low | Fallback to generic icon for unknown types (already implemented) |

---

## Next Steps

1. **Phase 1**: Create data model and contracts
2. **Phase 1**: Generate quickstart guide
3. **Phase 2**: Generate tasks.md with implementation steps
