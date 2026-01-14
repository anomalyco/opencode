# Implementation Plan: File Activity Highlight

**Branch**: `003-file-activity-highlight` | **Date**: 2026-01-14 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/003-file-activity-highlight/spec.md`

## Summary

Implement visual highlighting in the file explorer sidebar to indicate files that have been read, edited, or created by the AI model during the current session. The feature extends the existing `FileTree` component with activity state tracking, using the established Solid.js store system and event emitter pattern. Activity indicators will use distinct colors (success/warning/critical from theme) and badge tags to differentiate between read, edited, and created files.

## Technical Context

**Language/Version**: TypeScript 5.8.2 (frontend), Rust 2024 Edition (Tauri backend)
**Primary Dependencies**: Solid.js 1.9.10, Tailwind CSS 4.1.11, @kobalte/core 0.13.11, Vite 7.1.4
**Storage**: In-memory Solid.js store (session-scoped, no persistence required)
**Testing**: Vitest (frontend unit tests)
**Target Platform**: Desktop (Tauri) - macOS, Windows, Linux
**Project Type**: Monorepo with packages/app (frontend) and Tauri backend
**Performance Goals**: Activity highlights appear within 500ms of file operation
**Constraints**: Session-scoped state only, no persistence across sessions
**Scale/Scope**: Single workspace context, unlimited files per session

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The constitution file is a template without project-specific principles defined. No specific gates apply. The implementation follows existing codebase patterns:

- ✅ Uses existing Solid.js store pattern from `local.tsx`
- ✅ Follows established event emitter pattern from `sdk.tsx`
- ✅ Extends existing component patterns (file-tree.tsx styling)
- ✅ Uses existing theme colors (openwork.json)
- ✅ No new external dependencies required

## Project Structure

### Documentation (this feature)

```text
specs/003-file-activity-highlight/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (internal event contracts)
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (repository root)

```text
packages/app/src/
├── components/
│   ├── file-tree.tsx              # Modify: Add activity visual indicators
│   ├── file-activity-badge.tsx    # New: Badge component for activity type
│   └── workspace-sidebar.tsx      # Modify: Pass activity context to FileTree
├── context/
│   ├── local.tsx                  # Modify: Add activity tracking state
│   └── file-activity.tsx          # New: Activity tracking context
├── types/
│   └── file-activity.ts           # New: Activity type definitions
└── hooks/
    └── use-file-activity.ts       # New: Activity tracking hook

packages/ui/src/
├── components/
│   └── badge.tsx                  # New: Generic badge component (if needed)
└── theme/
    └── themes/openwork.json       # Reference: existing colors
```

**Structure Decision**: Extends existing monorepo structure. New activity tracking is added as a separate context to maintain separation of concerns while integrating with the existing `local.tsx` file state.

## Complexity Tracking

> No constitution violations identified. Implementation follows existing patterns.

| Aspect | Decision | Rationale |
|--------|----------|-----------|
| Separate context file | file-activity.tsx | Keeps activity logic separate from file system operations |
| In-memory storage only | Session-scoped | Per spec requirement FR-007: clear on new session |
| Theme colors only | No new colors | Uses existing success/warning/critical semantic colors |
