# Implementation Plan: Workspace Files Sidebar

**Branch**: `001-workspace-files-sidebar` | **Date**: 2026-01-14 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-workspace-files-sidebar/spec.md`

## Summary

Implement a secondary sidebar on the right side of the application that displays the workspace folder contents as an interactive file tree. The sidebar will use the existing design system (Solid.js, Tailwind CSS, Kobalte components) and leverage the FileIcon component for recognizable file type icons. Users can browse, expand/collapse folders, select files, and toggle sidebar visibility with state persistence.

## Technical Context

**Language/Version**: TypeScript 5.8.2 / Rust 2024 Edition (Tauri backend)
**Primary Dependencies**: Solid.js 1.9.10, Tailwind CSS 4.1.11, @kobalte/core 0.13.11, Vite 7.1.4
**Storage**: @tauri-apps/plugin-store for desktop persistence, localStorage for web
**Testing**: Bun:test (native Bun testing framework)
**Target Platform**: macOS, Windows, Linux (Tauri v2 desktop app)
**Project Type**: Monorepo with packages/app (core), packages/ui (components), packages/desktop (Tauri wrapper)
**Performance Goals**: File tree renders within 1 second for up to 1,000 files
**Constraints**: Must match primary sidebar styling; leverage existing FileIcon sprite system
**Scale/Scope**: Typical workspace folders of 100-1,000 files

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Status**: PASSED - Constitution file contains template placeholders only (no active constraints defined).

No specific gates to enforce. Following project conventions:
- Component-first design with Solid.js patterns
- Reuse existing UI components from packages/ui
- Follow established design tokens and theme system
- Use platform abstraction layer for storage

## Project Structure

### Documentation (this feature)

```text
specs/001-workspace-files-sidebar/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (repository root)

```text
packages/
├── app/
│   ├── src/
│   │   ├── components/
│   │   │   └── workspace-sidebar.tsx    # NEW: Secondary sidebar component
│   │   ├── context/
│   │   │   └── layout.tsx               # MODIFY: Add secondary sidebar state
│   │   ├── pages/
│   │   │   └── layout.tsx               # MODIFY: Integrate secondary sidebar
│   │   └── utils/
│   │       └── persist.ts               # REUSE: Sidebar visibility persistence
│   └── ...
├── ui/
│   ├── src/
│   │   ├── components/
│   │   │   ├── file-tree.tsx            # REUSE: Existing file tree component
│   │   │   ├── file-icon.tsx            # REUSE: File type icons
│   │   │   ├── icon.tsx                 # REUSE: UI icons (chevrons, toggle)
│   │   │   ├── tooltip.tsx              # REUSE: Path tooltips on hover
│   │   │   └── collapsible.tsx          # REUSE: Folder expand/collapse
│   │   └── ...
│   └── ...
└── ...
```

**Structure Decision**: Extending existing monorepo structure. New component in packages/app/src/components, leveraging packages/ui components. Layout integration in existing pages/layout.tsx.

## Complexity Tracking

> No violations - feature aligns with existing architecture patterns.
