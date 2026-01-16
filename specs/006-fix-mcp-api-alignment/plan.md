# Implementation Plan: Fix MCP Connectors API Alignment

**Branch**: `006-fix-mcp-api-alignment` | **Date**: 2026-01-15 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/006-fix-mcp-api-alignment/spec.md`

## Summary

Fix 52 TypeScript compilation errors in the MCP Connectors feature by aligning API usage with the project's actual component interfaces. The existing implementation has correct architecture and logic - only API surface adjustments are needed for Dialog, Icon, Toast, File I/O, Button, and Zod error handling patterns.

## Technical Context

**Language/Version**: TypeScript 5.8.2 (frontend), Rust 2024 Edition (Tauri backend)
**Primary Dependencies**: Solid.js 1.9.10, @kobalte/core 0.13.11, Tailwind CSS 4.1.11, Vite 7.1.4, @tauri-apps/api (filesystem), Zod (validation)
**Storage**: File system (`.mcp.json` in workspace root)
**Testing**: Manual integration testing (compile, build, runtime verification)
**Target Platform**: Desktop (macOS, Windows, Linux via Tauri)
**Project Type**: Monorepo (packages/app, packages/ui, packages/desktop)
**Performance Goals**: UI renders within 2 seconds, file operations complete within 1 second
**Constraints**: Must maintain existing architecture, no new dependencies
**Scale/Scope**: 5 files, 52 errors to fix

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The constitution file contains template placeholders rather than concrete principles. Given the absence of specific constraints, this implementation plan adheres to the following implicit standards:

| Principle | Status | Notes |
|-----------|--------|-------|
| Use existing patterns | ✅ Pass | All fixes use patterns already established in codebase |
| No new dependencies | ✅ Pass | Using existing @tauri-apps/api for file operations |
| Minimal changes | ✅ Pass | Only API surface adjustments, no architectural changes |
| Type safety | ✅ Pass | Fixes improve type safety (Zod issues, return types) |
| Testability | ✅ Pass | All changes can be verified via compile + runtime tests |

**Gate Status**: PASSED - No violations, proceeding to Phase 0.

## Project Structure

### Documentation (this feature)

```text
specs/006-fix-mcp-api-alignment/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 output - API investigation results
├── data-model.md        # Phase 1 output - Entity mappings (minimal for fixes)
├── quickstart.md        # Phase 1 output - How to apply fixes
├── contracts/           # Phase 1 output - Component API contracts
│   ├── dialog-api.md    # Dialog component usage patterns
│   ├── toast-api.md     # Toast notification patterns
│   └── icon-api.md      # Icon component patterns
└── checklists/
    └── requirements.md  # Specification validation checklist
```

### Source Code (files to modify)

```text
packages/app/src/
├── components/
│   ├── mcp-connector-form.tsx       # Dialog API fixes (12 errors)
│   ├── mcp-connector-item.tsx       # Icon fixes (3 errors)
│   └── mcp-connectors-section.tsx   # Dialog, Toast, Button fixes (18 errors)
├── context/
│   └── mcp-connectors.tsx           # File I/O, Zod, Type fixes (19 errors)
└── types/
    └── mcp-connectors.ts            # Type definitions (no changes needed)
```

**Structure Decision**: Existing monorepo structure preserved. Changes are localized to 4 files in packages/app/src/.

## Complexity Tracking

No complexity violations. All changes are straightforward API replacements within existing architecture:

| Aspect | Complexity | Justification |
|--------|------------|---------------|
| Dialog refactor | Medium | Uses existing useDialog() hook, follows project patterns |
| File I/O change | Low | Simple API swap to Tauri writeTextFile |
| Icon replacements | Low | Find/replace with existing icon names |
| Toast API | Low | Change from 2-arg to object syntax |
| Zod fixes | Low | Property rename from .errors to .issues |
| Type fixes | Low | Correct return type declarations |

## Fix Categories Summary

### Category 1: File I/O API (CRITICAL) - 2 errors
- **Problem**: `sdk.client.file.write()` doesn't exist
- **Solution**: Use `writeTextFile` from `@tauri-apps/api/fs`
- **Files**: `context/mcp-connectors.tsx` lines 184, 203

### Category 2: Dialog Component API (HIGH) - 25 errors
- **Problem**: Using compound pattern (Dialog.Content) but project uses simple Dialog
- **Solution**: Use `useDialog()` hook + simple Dialog props
- **Files**: `mcp-connector-form.tsx`, `mcp-connectors-section.tsx`

### Category 3: Icon Names (MEDIUM) - 10 errors
- **Problem**: Icons `spinner`, `edit`, `trash`, `lock`, `alert-triangle` don't exist
- **Solution**: Map to existing icons: `pencil-line`, `close`, text indicators
- **Files**: All 3 component files

### Category 4: Button Variants (LOW) - 1 error
- **Problem**: `variant="destructive"` doesn't exist
- **Solution**: Use `variant="primary"` or default
- **Files**: `mcp-connectors-section.tsx`

### Category 5: Toast API (MEDIUM) - 4 errors
- **Problem**: Using 2-argument call, expects single object
- **Solution**: Use `showToast({ title: "...", variant: "success" })`
- **Files**: `mcp-connectors-section.tsx`

### Category 6: Zod Error Handling (LOW) - 4 errors
- **Problem**: Using `.errors` but ZodError uses `.issues`
- **Solution**: Change to `error.issues.map(...)`
- **Files**: `context/mcp-connectors.tsx`

### Category 7: Type Safety (LOW) - 4 errors
- **Problem**: Return type mismatches, incorrect JSON.parse
- **Solution**: Fix return types, access correct properties
- **Files**: `context/mcp-connectors.tsx`

## Implementation Approach

### Phase 1: Critical Path (Enables Compilation)
1. Fix File I/O - enables save/load functionality
2. Fix Dialog API - enables form display
3. Fix Icon names - enables UI rendering

### Phase 2: Full Functionality
4. Fix Toast API - enables user feedback
5. Fix Zod errors - enables detailed validation messages
6. Fix Button variants - correct visual styling
7. Fix Type safety - improves code correctness

### Verification Steps
1. `pnpm typecheck` - 0 TypeScript errors
2. `pnpm build` - successful build
3. Launch app - no runtime errors
4. Test CRUD operations on connectors

## Constitution Check (Post-Design)

*Re-evaluation after Phase 1 design completion.*

| Principle | Status | Post-Design Notes |
|-----------|--------|-------------------|
| Use existing patterns | ✅ Pass | Dialog uses useDialog(), Toast uses options object, Icons mapped to existing set |
| No new dependencies | ✅ Pass | Only using already-installed @tauri-apps/api |
| Minimal changes | ✅ Pass | 4 files modified, all API surface changes only |
| Type safety | ✅ Pass | Zod .issues, correct return types documented |
| Testability | ✅ Pass | Compile + runtime verification defined in quickstart.md |

**Post-Design Gate Status**: PASSED - Design artifacts align with project standards.

## Generated Artifacts

| Artifact | Path | Description |
|----------|------|-------------|
| Research | [research.md](./research.md) | API investigation and decisions |
| Data Model | [data-model.md](./data-model.md) | Entity mappings (unchanged) |
| Quickstart | [quickstart.md](./quickstart.md) | Step-by-step fix guide |
| Dialog Contract | [contracts/dialog-api.md](./contracts/dialog-api.md) | Dialog usage patterns |
| Toast Contract | [contracts/toast-api.md](./contracts/toast-api.md) | Toast notification patterns |
| Icon Contract | [contracts/icon-api.md](./contracts/icon-api.md) | Icon and IconButton patterns |

## Next Steps

Planning is complete. To continue:

1. **Generate tasks**: Run `/speckit.tasks` to create actionable task list
2. **Implement fixes**: Run `/speckit.implement` to apply the fixes
3. **Verify**: Follow verification steps in quickstart.md
