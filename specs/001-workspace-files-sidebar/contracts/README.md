# Contracts: Workspace Files Sidebar

**Feature**: 001-workspace-files-sidebar
**Date**: 2026-01-14

## Overview

This feature does not expose REST APIs. All contracts are TypeScript interfaces defining component props and context APIs.

## Contract Files

| File | Description |
|------|-------------|
| `layout-context.ts` | Extension to layout context for sidebar state management |
| `workspace-sidebar.tsx` | Component props and internal contracts |

## Key Interfaces

### Layout Context Extension

```typescript
interface WorkspaceSidebarAPI {
  opened: () => boolean
  open: () => void
  close: () => void
  toggle: () => void
  width: () => number
  resize: (width: number) => void
}
```

### Component Props

```typescript
interface WorkspaceSidebarProps {
  workspacePath: string
  width: number
  onResize?: (width: number) => void
  onFileSelect?: (filePath: string) => void
  onFileActivate?: (filePath: string) => void
  class?: string
}
```

## Usage

These contracts serve as the implementation specification. Actual components will be created in:

- `packages/app/src/components/workspace-sidebar.tsx`
- `packages/app/src/context/layout.tsx` (modified)
