# Tasks: Fix MCP Connectors API Alignment

**Input**: Design documents from `/specs/006-fix-mcp-api-alignment/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, quickstart.md, contracts/

**Tests**: Manual integration testing only (compile, build, runtime verification). No automated tests requested.

**Organization**: Tasks are grouped by fix category (aligned with user stories) to enable incremental fixes and verification.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4)
- Include exact file paths in descriptions

## Path Conventions

- **Project Type**: Monorepo
- **App Package**: `packages/app/src/`
- **UI Package**: `packages/ui/src/`

---

## Phase 1: Setup

**Purpose**: Preparation and verification of current state

- [x] T001 Verify branch is `006-fix-mcp-api-alignment` and pull latest changes
- [x] T002 Run `pnpm typecheck` in packages/app to document baseline error count (52 expected)

---

## Phase 2: Foundational - File I/O Fix (CRITICAL)

**Purpose**: Fix the core file write capability that ALL user stories depend on

**⚠️ CRITICAL**: No user story can function without file persistence working

- [x] T003 Add import for `writeTextFile` from `@tauri-apps/api/fs` at top of `packages/app/src/context/mcp-connectors.tsx`
- [x] T004 Replace `sdk.client.file.write()` call in save() function (~line 184) with `writeTextFile()` in `packages/app/src/context/mcp-connectors.tsx`
- [x] T005 Replace `sdk.client.file.write()` call in createDefaultFile() function (~line 203) with `writeTextFile()` in `packages/app/src/context/mcp-connectors.tsx`

**Checkpoint**: File I/O errors resolved (50 errors remaining)

---

## Phase 3: User Story 1 - View and Manage MCP Connectors (Priority: P1) 🎯 MVP

**Goal**: Enable app to compile and render the connectors UI so users can view their configured connectors

**Independent Test**: Launch app, navigate to connectors section, verify existing connectors display

### Type Safety Fixes for User Story 1

- [x] T006 [US1] Fix JSON.parse to access `result.data.content` instead of `result` (~line 141) in `packages/app/src/context/mcp-connectors.tsx`
- [x] T007 [US1] Fix return type mismatch at line ~148 - remove `data: config` from void return in `packages/app/src/context/mcp-connectors.tsx`
- [x] T008 [US1] Fix return type mismatch at line ~180 - remove `data: config` from void return in `packages/app/src/context/mcp-connectors.tsx`
- [x] T009 [US1] Fix return type mismatch at line ~432 - remove `data: config` from void return in `packages/app/src/context/mcp-connectors.tsx`

### Zod Error Handling Fixes for User Story 1

- [x] T010 [P] [US1] Change `.errors` to `.issues` on ZodError at line ~78 in `packages/app/src/context/mcp-connectors.tsx`
- [x] T011 [P] [US1] Change `.errors` to `.issues` on ZodError at line ~114 in `packages/app/src/context/mcp-connectors.tsx`
- [x] T012 [P] [US1] Change `.errors` to `.issues` on ZodError at line ~366 in `packages/app/src/context/mcp-connectors.tsx`
- [x] T013 [P] [US1] Change `.errors` to `.issues` on ZodError at line ~389 in `packages/app/src/context/mcp-connectors.tsx`

### Icon Fixes for Connector Item Display

- [ ] T014 [P] [US1] Replace `icon="edit"` with `icon="pencil-line"` in `packages/app/src/components/mcp-connector-item.tsx`
- [ ] T015 [P] [US1] Replace `icon="trash"` with `icon="close"` in `packages/app/src/components/mcp-connector-item.tsx`
- [ ] T016 [P] [US1] Remove `size="small"` from IconButton components in `packages/app/src/components/mcp-connector-item.tsx`

### Icon Fixes for Connectors Section Display

- [ ] T017 [P] [US1] Replace `icon="alert-triangle"` with `icon="circle-error"` for error state in `packages/app/src/components/mcp-connectors-section.tsx`
- [ ] T018 [P] [US1] Replace `icon="spinner"` with loading indicator (CSS animation or alternative) in `packages/app/src/components/mcp-connectors-section.tsx`

**Checkpoint**: Run `pnpm typecheck` - context and basic display errors should be resolved. App should compile.

---

## Phase 4: User Story 2 - Add New MCP Connector (Priority: P2)

**Goal**: Enable users to add new connectors through the form dialog

**Independent Test**: Click "Add Connector", fill form, save, verify connector appears in list

### Dialog API Fixes for Add Form

- [ ] T019 [US2] Add import for `useDialog` from `@opencode-ai/ui/context/dialog` in `packages/app/src/components/mcp-connector-form.tsx`
- [ ] T020 [US2] Refactor Dialog from compound pattern to simple props pattern in `packages/app/src/components/mcp-connector-form.tsx` - replace `<Dialog.Content>`, `<Dialog.Header>`, `<Dialog.Title>`, `<Dialog.Description>`, `<Dialog.Footer>` with simple `<Dialog title="..." description="...">` and manual button container
- [ ] T021 [US2] Implement dialog state management using `useDialog()` hook pattern in `packages/app/src/components/mcp-connector-form.tsx`

### Icon Fixes for Add Form

- [ ] T022 [P] [US2] Replace `icon="spinner"` with loading indicator for submit button in `packages/app/src/components/mcp-connector-form.tsx`
- [ ] T023 [P] [US2] Replace `icon="lock"` with text indicator "(sensitive)" for env var fields in `packages/app/src/components/mcp-connector-form.tsx`
- [ ] T024 [P] [US2] Remove any `size="small"` from IconButton components in `packages/app/src/components/mcp-connector-form.tsx`

### Toast Notifications for Add Operations

- [ ] T025 [US2] Fix `showToast()` call for successful add - change from 2-arg to object syntax in `packages/app/src/components/mcp-connectors-section.tsx` (line ~66)
- [ ] T026 [US2] Fix `showToast()` call for failed add - change from 2-arg to object syntax in `packages/app/src/components/mcp-connectors-section.tsx` (line ~94)

**Checkpoint**: Add connector dialog should open, validate, and save correctly

---

## Phase 5: User Story 3 - Edit Existing MCP Connector (Priority: P3)

**Goal**: Enable users to edit existing connector configurations

**Independent Test**: Click edit on existing connector, modify fields, save, verify changes persist

### Dialog Reuse for Edit Form

- [ ] T027 [US3] Verify edit mode uses same Dialog component refactored in T020-T021 in `packages/app/src/components/mcp-connector-form.tsx`
- [ ] T028 [US3] Ensure form pre-populates correctly with existing connector data in edit mode

**Checkpoint**: Edit connector functionality should work with refactored dialog

---

## Phase 6: User Story 4 - Remove MCP Connector (Priority: P4)

**Goal**: Enable users to remove connectors with confirmation dialog

**Independent Test**: Click remove on connector, confirm in dialog, verify connector removed from list and file

### Dialog API Fixes for Delete Confirmation

- [ ] T029 [US4] Add import for `useDialog` from `@opencode-ai/ui/context/dialog` in `packages/app/src/components/mcp-connectors-section.tsx`
- [ ] T030 [US4] Refactor delete confirmation Dialog from compound pattern to simple props pattern in `packages/app/src/components/mcp-connectors-section.tsx`
- [ ] T031 [US4] Implement delete confirmation using `dialog.show()` and `dialog.close()` pattern in `packages/app/src/components/mcp-connectors-section.tsx`

### Button Variant Fix for Delete

- [ ] T032 [US4] Replace `variant="destructive"` with `variant="primary"` on Remove button in `packages/app/src/components/mcp-connectors-section.tsx` (line ~258)

### Toast Notifications for Remove Operations

- [ ] T033 [US4] Fix `showToast()` call for successful remove - change from 2-arg to object syntax in `packages/app/src/components/mcp-connectors-section.tsx` (line ~137)
- [ ] T034 [US4] Fix `showToast()` call for failed remove - change from 2-arg to object syntax in `packages/app/src/components/mcp-connectors-section.tsx` (line ~141)

**Checkpoint**: Delete confirmation dialog should appear, remove operation should complete

---

## Phase 7: Polish & Verification

**Purpose**: Final validation across all user stories

- [ ] T035 Run `pnpm typecheck` in packages/app - verify 0 TypeScript errors
- [ ] T036 Run `pnpm build` - verify successful build
- [ ] T037 Run `pnpm dev` - verify app launches without runtime errors
- [ ] T038 Manual test: View connectors section with existing `.mcp.json` (US1)
- [ ] T039 Manual test: Add new connector via form dialog (US2)
- [ ] T040 Manual test: Edit existing connector (US3)
- [ ] T041 Manual test: Remove connector with confirmation (US4)
- [ ] T042 Manual test: Verify changes persist after app restart
- [ ] T043 Manual test: Verify empty state displays when no connectors configured

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies - start immediately
- **Phase 2 (File I/O)**: Depends on Setup - BLOCKS all user stories
- **Phase 3 (US1 - View)**: Depends on Phase 2 - MVP target
- **Phase 4 (US2 - Add)**: Depends on Phase 3 (needs UI to render)
- **Phase 5 (US3 - Edit)**: Depends on Phase 4 (reuses add form)
- **Phase 6 (US4 - Remove)**: Depends on Phase 3 (needs UI to render)
- **Phase 7 (Polish)**: Depends on all previous phases

### User Story Dependencies

```
Phase 2 (File I/O)
       |
       v
Phase 3 (US1 - View) -----> Phase 4 (US2 - Add) -----> Phase 5 (US3 - Edit)
       |
       +-------------------> Phase 6 (US4 - Remove)
```

### Within Each Phase

- Zod fixes (T010-T013) can run in parallel
- Icon fixes within same file can run in parallel
- Dialog refactoring must be sequential within a file

### Parallel Opportunities

**Phase 3 Parallel Tasks:**
```
T010, T011, T012, T013  # All Zod fixes
T014, T015, T016        # All mcp-connector-item.tsx icon fixes
T017, T018              # mcp-connectors-section.tsx icon fixes
```

**Phase 4 Parallel Tasks:**
```
T022, T023, T024        # All form icon fixes
```

---

## Parallel Example: Phase 3 (US1)

```bash
# Zod fixes - all parallel (different lines, same file but independent):
T010: Change .errors to .issues at line ~78
T011: Change .errors to .issues at line ~114
T012: Change .errors to .issues at line ~366
T013: Change .errors to .issues at line ~389

# Icon fixes - parallel across files:
T014, T015, T016: mcp-connector-item.tsx
T017, T018: mcp-connectors-section.tsx
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: File I/O (CRITICAL)
3. Complete Phase 3: User Story 1 (View)
4. **STOP and VALIDATE**: Run typecheck, build, launch app
5. If compiles and renders: MVP achieved!

### Incremental Delivery

1. Setup + File I/O → Foundation ready
2. Add US1 (View) → App compiles and displays connectors
3. Add US2 (Add) → Users can add new connectors
4. Add US3 (Edit) → Users can modify existing connectors
5. Add US4 (Remove) → Full CRUD complete
6. Polish → All verification tests pass

### Single Developer Strategy

Given this is a fix task with inter-file dependencies:
1. Complete Setup through US1 sequentially
2. US2, US3, US4 can be done sequentially or interleaved
3. Run verification after each user story completion

---

## Notes

- [P] tasks = different files OR independent lines in same file
- [Story] label maps task to specific user story for traceability
- This is a fix task - all changes are API surface adjustments, no architectural changes
- Commit after each phase for easy rollback
- Total: 43 tasks across 7 phases
- Error reduction: 52 → 0 TypeScript errors
