# Implementation Plan: MCP Connectors Management

**Branch**: `004-mcp-connectors` | **Date**: 2026-01-15 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/004-mcp-connectors/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Create a "Connectors" section in the bottom right corner of the desktop app that allows users to manage MCP server configurations in the `.mcp.json` file. The section will support viewing, adding, editing, and removing connector entries, with automatic file initialization if the `.mcp.json` file doesn't exist. Implementation will follow existing patterns from FileActivitySection and integrate with the centralized layout management system.

## Technical Context

**Language/Version**: TypeScript 5.8.2 (frontend), Rust 2024 Edition (Tauri backend)
**Primary Dependencies**: Solid.js 1.9.10, @kobalte/core 0.13.11, Tailwind CSS 4.1.11, Vite 7.1.4, @tauri-apps/plugin-store (persistence), @solidjs/router (routing)
**Storage**: File system (`.mcp.json` in workspace root), @tauri-apps/plugin-store for UI state persistence
**Testing**: Vitest for unit/integration tests, Playwright for E2E tests (following existing patterns)
**Target Platform**: Desktop (Tauri 2.x - macOS, Windows, Linux)
**Project Type**: Desktop application (monorepo with packages/app, packages/ui, packages/desktop)
**Performance Goals**: Load connectors within 2 seconds of app launch, instant UI updates on file changes
**Constraints**: Must use existing SDK client for file I/O, must integrate with centralized layout store, must follow Solid.js reactive patterns
**Scale/Scope**: ~10 connector configurations per workspace, file size <100KB, UI component ~500 LOC

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Status**: ✓ PASS (No constitution file exists - using default best practices)

**Note**: The project does not have an established constitution file (`.specify/memory/constitution.md` contains only a template). Therefore, we'll follow industry best practices:

1. **Component-Based Architecture**: ✓ Feature will be implemented as a self-contained component following existing patterns
2. **Type Safety**: ✓ All TypeScript code will be fully typed with no `any` types
3. **Reactive Patterns**: ✓ Will use Solid.js reactive primitives (createStore, createSignal, createEffect)
4. **Context Isolation**: ✓ Will create dedicated `McpConnectorsContext` following existing context pattern
5. **Testability**: ✓ Will write unit tests for business logic and integration tests for file operations
6. **Accessibility**: ✓ Will use @kobalte/core components which are accessible by default

**No violations** - feature aligns with existing architecture patterns.

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
packages/
├── app/                                    # Main application logic
│   ├── src/
│   │   ├── components/
│   │   │   ├── mcp-connectors-section.tsx    # NEW: Main Connectors UI component
│   │   │   ├── mcp-connector-form.tsx        # NEW: Add/Edit connector form
│   │   │   ├── mcp-connector-item.tsx        # NEW: Individual connector list item
│   │   │   ├── file-activity-section.tsx     # REFERENCE: Similar pattern
│   │   │   └── workspace-sidebar.tsx         # REFERENCE: Panel pattern
│   │   ├── context/
│   │   │   ├── mcp-connectors.tsx            # NEW: MCP connectors context & state
│   │   │   ├── layout.tsx                    # MODIFY: Add connectors panel state
│   │   │   ├── local.tsx                     # REFERENCE: File operations pattern
│   │   │   └── sdk.tsx                       # REFERENCE: SDK client usage
│   │   ├── types/
│   │   │   └── mcp-connectors.ts             # NEW: Type definitions
│   │   └── pages/
│   │       ├── session.tsx                   # MODIFY: Add ConnectorsSection
│   │       └── directory-layout.tsx          # MODIFY: Add McpConnectorsProvider
│   └── tests/
│       ├── unit/
│       │   └── mcp-connectors.test.ts        # NEW: Unit tests
│       └── integration/
│           └── mcp-connectors-file.test.ts   # NEW: File I/O tests
│
├── ui/                                     # Shared UI components
│   └── src/components/
│       ├── collapsible.tsx                 # EXISTING: Used for expandable section
│       ├── dialog.tsx                      # EXISTING: Used for forms/confirmations
│       ├── button.tsx                      # EXISTING: Used for actions
│       └── icon-button.tsx                 # EXISTING: Used for edit/remove
│
└── desktop/                                # Tauri app entry
    └── src-tauri/                          # No changes needed (file I/O via SDK)
```

**Structure Decision**: Desktop application using existing monorepo structure. New feature components will be added to `packages/app/src/components/` following the established pattern from FileActivitySection. The feature will integrate with the centralized layout system in `packages/app/src/context/layout.tsx` and use the existing SDK client for file operations. No backend changes required as file I/O is handled through Tauri's file system APIs.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

**Status**: N/A - No violations detected. Feature follows existing architectural patterns.
