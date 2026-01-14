# Quickstart: Workspace Files Sidebar

**Feature**: 001-workspace-files-sidebar
**Date**: 2026-01-14

## Prerequisites

- Bun 1.3.5+ installed
- Repository cloned and dependencies installed

```bash
bun install
```

## Development Server

```bash
# Start Vite dev server (web mode)
cd packages/app
bun run dev

# Or run Tauri desktop app
cd packages/desktop
bun run tauri dev
```

## Key Files to Modify

### 1. Layout Context (State Management)

**File**: `packages/app/src/context/layout.tsx`

Add workspace sidebar state to the store:

```typescript
const [store, setStore, _, ready] = persisted(
  Persist.global("layout", ["layout.v7"]),  // Increment version
  createStore({
    // ... existing state
    workspaceSidebar: {
      opened: false,
      width: 300,
    },
  }),
)
```

Add API to returned context:

```typescript
workspaceSidebar: {
  opened: createMemo(() => store.workspaceSidebar.opened),
  toggle() { setStore("workspaceSidebar", "opened", (x) => !x) },
  width: createMemo(() => store.workspaceSidebar.width),
  resize(width: number) {
    setStore("workspaceSidebar", "width", Math.max(200, Math.min(600, width)))
  },
},
```

### 2. New Component

**File**: `packages/app/src/components/workspace-sidebar.tsx` (create new)

```typescript
import { FileTree } from "./file-tree"
import { useLayout } from "../context/layout"

export function WorkspaceSidebar(props: { workspacePath: string }) {
  const layout = useLayout()

  return (
    <div
      class="flex flex-col border-l border-border-weak-base bg-background-base"
      style={{ width: `${layout.workspaceSidebar.width()}px` }}
    >
      <div class="px-3 py-2 border-b border-border-weak-base flex items-center justify-between">
        <span class="text-12-medium text-text-weak">Files</span>
        <IconButton onClick={layout.workspaceSidebar.close} icon="close" />
      </div>
      <div class="flex-1 overflow-y-auto">
        <FileTree
          path={props.workspacePath}
          onFileClick={(file) => console.log("Selected:", file.path)}
        />
      </div>
    </div>
  )
}
```

### 3. Layout Integration

**File**: `packages/app/src/pages/layout.tsx`

Add to main layout:

```typescript
<Show when={layout.workspaceSidebar.opened() && isDesktop()}>
  <ResizeHandle
    direction="horizontal"
    size={layout.workspaceSidebar.width()}
    min={200}
    max={600}
    onResize={layout.workspaceSidebar.resize}
  />
  <WorkspaceSidebar workspacePath={currentProject().worktree} />
</Show>
```

### 4. Command Registration

**File**: `packages/app/src/pages/layout.tsx` or `session.tsx`

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

## Testing

```bash
# Run existing tests
cd packages/app
bun test
```

Manual testing checklist:
- [ ] Open app, press `Cmd+Shift+E` (or `Ctrl+Shift+E` on Windows/Linux)
- [ ] Sidebar appears on right with file tree
- [ ] Click folders to expand/collapse
- [ ] Click files to select (visual highlight)
- [ ] Drag resize handle to adjust width
- [ ] Close and reopen app - sidebar state persists
- [ ] Hover files to see path tooltip

## Debugging

```bash
# Check localStorage for persisted state
# In browser console:
localStorage.getItem("layout.v7")

# View component in Solid DevTools (browser extension)
```

## Common Issues

| Issue | Solution |
|-------|----------|
| Sidebar not appearing | Check `layout.workspaceSidebar.opened()` returns true |
| Width not persisting | Verify version bump to `layout.v7` |
| File icons missing | Ensure FileIcon sprite loaded (`/file-icons/sprite.svg`) |
| TypeError on resize | Check min/max bounds (200-600) |
