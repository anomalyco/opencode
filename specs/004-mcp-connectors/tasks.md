# Tasks: MCP Connectors Management

**Input**: Design documents from `/specs/004-mcp-connectors/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- Base: `/Users/touchaponk/Documents/GitHub/openwork/`
- App source: `packages/app/src/`
- UI components: `packages/ui/src/components/`
- Tests: `packages/app/tests/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and TypeScript type definitions

- [x] T001 [P] Create TypeScript type definitions in packages/app/src/types/mcp-connectors.ts
- [x] T002 [P] Install zod validation library if not already present (check package.json)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core context and state management that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T003 Create McpConnectorsContext in packages/app/src/context/mcp-connectors.tsx with basic structure
- [x] T004 Implement file I/O operations (reload, save) using SDK client in packages/app/src/context/mcp-connectors.tsx
- [x] T005 Implement Zod validation schema for McpConfig in packages/app/src/context/mcp-connectors.tsx
- [x] T006 Add default config initialization (auto-create .mcp.json if missing) in packages/app/src/context/mcp-connectors.tsx
- [x] T007 Wire up McpConnectorsProvider in packages/app/src/pages/directory-layout.tsx
- [x] T008 Add connectors state to layout store in packages/app/src/context/layout.tsx

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - View MCP Server Connectors (Priority: P1) 🎯 MVP

**Goal**: Display all configured MCP servers from `.mcp.json` in a "Connectors" section in the bottom right corner

**Independent Test**: Open app with existing `.mcp.json` file → Connectors section displays server list with names and commands

**Acceptance Scenarios**:
1. With valid `.mcp.json`: Display all server names
2. Without `.mcp.json`: Auto-create empty file and show empty section
3. Each connector shows name and command type

### Implementation for User Story 1

- [x] T009 [P] [US1] Create McpConnectorItem component in packages/app/src/components/mcp-connector-item.tsx
- [x] T010 [P] [US1] Create McpConnectorsSection component skeleton in packages/app/src/components/mcp-connectors-section.tsx
- [x] T011 [US1] Implement connector list rendering with Solid.js <For> in packages/app/src/components/mcp-connectors-section.tsx
- [x] T012 [US1] Add Collapsible wrapper with header showing connector count in packages/app/src/components/mcp-connectors-section.tsx
- [x] T013 [US1] Display server name and command in McpConnectorItem in packages/app/src/components/mcp-connector-item.tsx
- [x] T014 [US1] Add McpConnectorsSection to session.tsx layout in packages/app/src/pages/session.tsx
- [x] T015 [US1] Wire up visibility toggle with layout.connectors.opened state in packages/app/src/components/mcp-connectors-section.tsx
- [x] T016 [US1] Handle loading state display (spinner/skeleton) in packages/app/src/components/mcp-connectors-section.tsx
- [x] T017 [US1] Handle error state display (error message) in packages/app/src/components/mcp-connectors-section.tsx
- [x] T018 [US1] Handle empty state display ("No connectors configured") in packages/app/src/components/mcp-connectors-section.tsx

**Checkpoint**: At this point, User Story 1 should be fully functional - users can view connectors

---

## Phase 4: User Story 2 - Add New MCP Server Connector (Priority: P2)

**Goal**: Allow users to add new connectors through a form dialog

**Independent Test**: Click "Add Connector" → Fill form → Submit → Connector appears in list and persists to `.mcp.json`

**Acceptance Scenarios**:
1. Click "Add Connector" → Form appears
2. Fill valid details → Submit → Connector added and saved
3. Provide env vars → Saved in "env" config
4. Cancel → No changes made

### Implementation for User Story 2

- [x] T019 [P] [US2] Create McpConnectorForm component skeleton in packages/app/src/components/mcp-connector-form.tsx
- [x] T020 [P] [US2] Implement form fields (name, command, args, env) in packages/app/src/components/mcp-connector-form.tsx
- [x] T021 [P] [US2] Create ArgsArrayInput helper component for managing args array in packages/app/src/components/mcp-connector-form.tsx
- [x] T022 [P] [US2] Create EnvVarInput helper component for managing env object in packages/app/src/components/mcp-connector-form.tsx
- [x] T023 [US2] Add form validation (required fields, duplicate names) in packages/app/src/components/mcp-connector-form.tsx
- [x] T024 [US2] Implement addServer method in McpConnectorsContext in packages/app/src/context/mcp-connectors.tsx
- [x] T025 [US2] Wire up form submit handler calling addServer in packages/app/src/components/mcp-connector-form.tsx
- [x] T026 [US2] Add "Add Connector" button to McpConnectorsSection in packages/app/src/components/mcp-connectors-section.tsx
- [x] T027 [US2] Handle form open/close state with Dialog component in packages/app/src/components/mcp-connector-form.tsx
- [x] T028 [US2] Display validation errors inline in form in packages/app/src/components/mcp-connector-form.tsx
- [x] T029 [US2] Show success notification after adding connector in packages/app/src/components/mcp-connector-form.tsx
- [x] T030 [US2] Add sensitive env var warning (🔒 icon) for keys containing API/KEY/TOKEN in packages/app/src/components/mcp-connector-form.tsx

**Checkpoint**: At this point, User Stories 1 AND 2 should both work - users can view and add connectors

---

## Phase 5: User Story 3 - Edit Existing MCP Server Connector (Priority: P3)

**Goal**: Allow users to modify existing connector configurations

**Independent Test**: Click "Edit" on connector → Modify fields → Save → Changes persist to `.mcp.json`

**Acceptance Scenarios**:
1. Click "Edit" → Form pre-filled with current config
2. Modify fields → Save → Changes persisted
3. Modify env vars → Updated values saved

### Implementation for User Story 3

- [x] T031 [P] [US3] Add Edit button (IconButton) to McpConnectorItem in packages/app/src/components/mcp-connector-item.tsx
- [x] T032 [US3] Implement updateServer method in McpConnectorsContext in packages/app/src/context/mcp-connectors.tsx
- [x] T033 [US3] Implement renameServer method in McpConnectorsContext in packages/app/src/context/mcp-connectors.tsx
- [x] T034 [US3] Add edit mode support to McpConnectorForm (mode prop: "add" | "edit") in packages/app/src/components/mcp-connector-form.tsx
- [x] T035 [US3] Pre-fill form fields with initialData in edit mode in packages/app/src/components/mcp-connector-form.tsx
- [x] T036 [US3] Handle server rename logic (delete old key, add new) in packages/app/src/components/mcp-connector-form.tsx
- [x] T037 [US3] Wire up edit button click handler in McpConnectorsSection in packages/app/src/components/mcp-connectors-section.tsx
- [x] T038 [US3] Update validation to exclude current name when editing in packages/app/src/components/mcp-connector-form.tsx

**Checkpoint**: User Stories 1, 2, AND 3 should all work - users can view, add, and edit connectors

---

## Phase 6: User Story 4 - Remove MCP Server Connector (Priority: P3)

**Goal**: Allow users to delete connectors they no longer need

**Independent Test**: Click "Remove" on connector → Confirm → Connector removed from UI and `.mcp.json`

**Acceptance Scenarios**:
1. Click "Remove" → Confirmation dialog appears
2. Confirm → Connector removed
3. Cancel → No changes made

### Implementation for User Story 4

- [x] T039 [P] [US4] Add Remove button (IconButton) to McpConnectorItem in packages/app/src/components/mcp-connector-item.tsx
- [x] T040 [US4] Implement removeServer method in McpConnectorsContext in packages/app/src/context/mcp-connectors.tsx
- [x] T041 [US4] Create confirmation dialog component or use Dialog primitive in packages/app/src/components/mcp-connectors-section.tsx
- [x] T042 [US4] Wire up remove button click handler with confirmation in packages/app/src/components/mcp-connectors-section.tsx
- [x] T043 [US4] Show server name in confirmation message in packages/app/src/components/mcp-connectors-section.tsx

**Checkpoint**: Core CRUD operations complete - users can view, add, edit, and remove connectors

---

## Phase 7: User Story 5 - Manage Input Configurations (Priority: P4)

**Goal**: Allow users to configure the "inputs" section of `.mcp.json` (advanced feature)

**Independent Test**: Access input settings → View/modify inputs → Changes persist to `.mcp.json`

**Acceptance Scenarios**:
1. Access input configuration → View current inputs array
2. Add new input type → Saved to "inputs" array

**Note**: MVP approach - read-only display + raw JSON editor

### Implementation for User Story 5

- [ ] T044 [P] [US5] Add "Advanced Settings" section to McpConnectorsSection in packages/app/src/components/mcp-connectors-section.tsx
- [ ] T045 [US5] Display inputs array as read-only JSON in advanced settings in packages/app/src/components/mcp-connectors-section.tsx
- [ ] T046 [US5] Add "Edit JSON" button for raw JSON editing in packages/app/src/components/mcp-connectors-section.tsx
- [ ] T047 [US5] Create simple JSON editor dialog (textarea with validation) in packages/app/src/components/mcp-connectors-section.tsx
- [ ] T048 [US5] Validate JSON on save and show errors in packages/app/src/components/mcp-connectors-section.tsx

**Checkpoint**: All user stories complete including advanced features

---

## Phase 8: File Watcher Integration

**Purpose**: Handle external changes to `.mcp.json` file

**FR-016 Requirement**: System MUST handle concurrent file modifications

- [ ] T049 Add file watcher using @tauri-apps/plugin-fs watch in packages/app/src/context/mcp-connectors.tsx
- [ ] T050 Implement handleExternalChange with unsaved changes check in packages/app/src/context/mcp-connectors.tsx
- [ ] T051 Show confirmation dialog on external change with unsaved changes in packages/app/src/context/mcp-connectors.tsx
- [ ] T052 Implement silent reload on external change without unsaved changes in packages/app/src/context/mcp-connectors.tsx
- [ ] T053 Debounce file watcher events (500ms) to prevent rapid reloads in packages/app/src/context/mcp-connectors.tsx

---

## Phase 9: Auto-Save & Performance

**Purpose**: Improve UX with auto-save and optimize performance

- [ ] T054 Implement auto-save with debouncing (500ms) using createEffect in packages/app/src/context/mcp-connectors.tsx
- [ ] T055 Add hasUnsavedChanges tracking in McpConnectorsContext in packages/app/src/context/mcp-connectors.tsx
- [ ] T056 Show unsaved changes indicator in UI in packages/app/src/components/mcp-connectors-section.tsx
- [ ] T057 Optimize list rendering with proper keying by server name in packages/app/src/components/mcp-connectors-section.tsx

---

## Phase 10: Error Handling & Edge Cases

**Purpose**: Handle all edge cases from spec.md

- [ ] T058 [P] Handle invalid JSON syntax error gracefully in packages/app/src/context/mcp-connectors.tsx
- [ ] T059 [P] Handle missing required fields with specific validation errors in packages/app/src/context/mcp-connectors.tsx
- [ ] T060 [P] Prevent duplicate server names in form validation in packages/app/src/components/mcp-connector-form.tsx
- [ ] T061 [P] Handle read-only file system error with user-friendly message in packages/app/src/context/mcp-connectors.tsx
- [ ] T062 Display warning for sensitive env vars (API_KEY, TOKEN, SECRET patterns) in packages/app/src/components/mcp-connector-form.tsx
- [ ] T063 Show toast notifications for all error scenarios in packages/app/src/components/mcp-connectors-section.tsx

---

## Phase 11: Unit & Integration Tests

**Purpose**: Ensure code quality and prevent regressions

### Unit Tests

- [ ] T064 [P] Create test file packages/app/tests/unit/mcp-connectors.test.ts
- [ ] T065 [P] Test Zod validation schema (valid and invalid configs) in packages/app/tests/unit/mcp-connectors.test.ts
- [ ] T066 [P] Test addServer state transition in packages/app/tests/unit/mcp-connectors.test.ts
- [ ] T067 [P] Test updateServer state transition in packages/app/tests/unit/mcp-connectors.test.ts
- [ ] T068 [P] Test removeServer state transition in packages/app/tests/unit/mcp-connectors.test.ts
- [ ] T069 [P] Test duplicate name detection in packages/app/tests/unit/mcp-connectors.test.ts
- [ ] T070 [P] Test isSensitiveEnvVar utility function in packages/app/tests/unit/mcp-connectors.test.ts

### Integration Tests

- [ ] T071 [P] Create test file packages/app/tests/integration/mcp-connectors-file.test.ts
- [ ] T072 [P] Test file read with existing valid file in packages/app/tests/integration/mcp-connectors-file.test.ts
- [ ] T073 [P] Test file read with missing file (auto-create) in packages/app/tests/integration/mcp-connectors-file.test.ts
- [ ] T074 [P] Test file read with corrupted JSON in packages/app/tests/integration/mcp-connectors-file.test.ts
- [ ] T075 [P] Test file write success in packages/app/tests/integration/mcp-connectors-file.test.ts
- [ ] T076 [P] Test file write permission denied error in packages/app/tests/integration/mcp-connectors-file.test.ts
- [ ] T077 Test file watcher external modification detection in packages/app/tests/integration/mcp-connectors-file.test.ts

---

## Phase 12: Polish & Cross-Cutting Concerns

**Purpose**: Final improvements and documentation

- [ ] T078 [P] Add loading skeleton for initial connector load in packages/app/src/components/mcp-connectors-section.tsx
- [ ] T079 [P] Add keyboard shortcuts (Cmd+N for new connector) in packages/app/src/components/mcp-connectors-section.tsx
- [ ] T080 [P] Improve form UX with better field labels and hints in packages/app/src/components/mcp-connector-form.tsx
- [ ] T081 [P] Add tooltips for complex fields (args, env vars) in packages/app/src/components/mcp-connector-form.tsx
- [ ] T082 Ensure accessibility with proper ARIA labels using @kobalte components in all component files
- [ ] T083 Code cleanup and remove console.logs in all new files
- [ ] T084 Run manual testing checklist from quickstart.md
- [ ] T085 Update CLAUDE.md if any new patterns were established

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies - can start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 - BLOCKS all user stories
- **Phase 3-7 (User Stories)**: All depend on Phase 2 completion
  - User stories can proceed in parallel if multiple developers
  - Or sequentially in priority order: US1 → US2 → US3 → US4 → US5
- **Phase 8-10 (Enhancements)**: Depend on US1-US4 (core CRUD)
- **Phase 11 (Tests)**: Can run after each user story completes
- **Phase 12 (Polish)**: Depends on all core features complete

### User Story Dependencies

- **User Story 1 (P1)**: Depends only on Phase 2 - No dependencies on other stories ✅ **MVP**
- **User Story 2 (P2)**: Depends on Phase 2 - Extends US1 but independently testable
- **User Story 3 (P3)**: Depends on Phase 2 - Uses form from US2 but independently testable
- **User Story 4 (P3)**: Depends on Phase 2 - Independent of US2/US3
- **User Story 5 (P4)**: Depends on Phase 2 - Low priority advanced feature

### Within Each User Story

1. Context methods before UI components
2. Helper components before main components
3. Core implementation before integration
4. Validation before submission
5. Error handling last

### Parallel Opportunities

**Phase 1** (all can run in parallel):
- T001 (types) + T002 (deps check)

**Phase 2** (sequential - context setup):
- T003-T008 must run in order

**Phase 3 - User Story 1** (some parallel):
- T009 (McpConnectorItem) + T010 (McpConnectorsSection skeleton) can run in parallel
- Then T011-T018 sequentially (integrate components)

**Phase 4 - User Story 2** (some parallel):
- T019-T022 (all form components) can run in parallel
- Then T023-T030 sequentially (integration)

**Phase 5 - User Story 3** (some parallel):
- T031 (UI button) + T032-T033 (context methods) can run in parallel
- Then T034-T038 sequentially

**Phase 6 - User Story 4** (some parallel):
- T039 (UI button) + T040 (context method) can run in parallel
- Then T041-T043 sequentially

**Phase 11 - Tests** (all can run in parallel):
- T064-T077 can all run in parallel (different test files or test cases)

**Different User Stories** (parallel if multiple developers):
- After Phase 2, Developer A can work on US1 while Developer B works on US2

---

## Parallel Example: User Story 1

```bash
# Can launch in parallel:
Task T009: "Create McpConnectorItem component"
Task T010: "Create McpConnectorsSection skeleton"

# Then sequentially integrate:
Task T011: "Implement connector list rendering"
Task T012: "Add Collapsible wrapper"
# ... etc
```

---

## Parallel Example: User Story 2

```bash
# Can launch in parallel:
Task T019: "Create McpConnectorForm skeleton"
Task T020: "Implement form fields"
Task T021: "Create ArgsArrayInput helper"
Task T022: "Create EnvVarInput helper"

# Then sequentially integrate:
Task T023: "Add form validation"
Task T024: "Implement addServer method"
# ... etc
```

---

## Implementation Strategy

### MVP First (User Story 1 Only) 🎯

1. Complete Phase 1: Setup (T001-T002)
2. Complete Phase 2: Foundational (T003-T008) ← CRITICAL
3. Complete Phase 3: User Story 1 (T009-T018)
4. **STOP and VALIDATE**:
   - Open app with `.mcp.json` → Connectors visible ✓
   - Open app without `.mcp.json` → Auto-creates file ✓
   - Each connector shows name and command ✓
5. Deploy/demo MVP if ready

**MVP Scope**: ~10 tasks, estimated 4-6 hours

### Incremental Delivery

1. **Foundation** (Phase 1-2) → Ready for all stories
2. **MVP** (Phase 3 - US1) → View connectors ✓
3. **Add Feature** (Phase 4 - US2) → + Add connectors ✓
4. **Edit Feature** (Phase 5 - US3) → + Edit connectors ✓
5. **Delete Feature** (Phase 6 - US4) → + Remove connectors ✓
6. **Advanced** (Phase 7 - US5) → + Input management (optional)
7. **Production Ready** (Phase 8-12) → File watch, auto-save, tests, polish

Each increment is independently testable and adds value.

### Parallel Team Strategy

With 2 developers:

1. **Together**: Complete Phase 1-2 (Foundation)
2. **Split**:
   - Developer A: User Story 1 (P1) + User Story 3 (P3)
   - Developer B: User Story 2 (P2) + User Story 4 (P3)
3. **Merge**: Integrate and test all stories together
4. **Together**: Phases 8-12 (enhancements, tests, polish)

---

## Task Summary

**Total Tasks**: 85
**By Phase**:
- Phase 1 (Setup): 2 tasks
- Phase 2 (Foundational): 6 tasks
- Phase 3 (US1 - View): 10 tasks
- Phase 4 (US2 - Add): 12 tasks
- Phase 5 (US3 - Edit): 8 tasks
- Phase 6 (US4 - Remove): 5 tasks
- Phase 7 (US5 - Inputs): 5 tasks
- Phase 8 (File Watch): 5 tasks
- Phase 9 (Auto-Save): 4 tasks
- Phase 10 (Error Handling): 6 tasks
- Phase 11 (Tests): 14 tasks
- Phase 12 (Polish): 8 tasks

**Parallel Opportunities**: 35 tasks marked [P]

**MVP Scope** (Phases 1-3): 18 tasks
**Full Feature** (Phases 1-7): 48 tasks
**Production Ready** (All phases): 85 tasks

---

## Notes

- All tasks follow checklist format: `- [ ] [ID] [P?] [Story?] Description with file path`
- [P] tasks target different files with no dependencies
- [Story] labels (US1-US5) map to user stories from spec.md
- Each user story delivers independently testable value
- Stop at any checkpoint to validate story works
- Commit after each task or logical group
- Follow patterns from existing codebase (FileActivitySection, Layout context)
- Use @kobalte/core components for accessibility
- No `any` types - full TypeScript type safety
- SDK client for all file I/O operations

---

## Success Criteria Mapping

- **SC-001** (Load <2s): Addressed in T004 (file I/O optimization)
- **SC-002** (Add <1min): Addressed in Phase 4 (US2 - streamlined form)
- **SC-003** (Edit <30s): Addressed in Phase 5 (US3 - pre-filled form)
- **SC-004** (100% persistence): Addressed in T004, T008, T054 (save operations)
- **SC-005** (100% prevent invalid JSON): Addressed in T005, T059 (validation)
- **SC-006** (No manual editing needed): Addressed in Phases 3-7 (full CRUD UI)
- **SC-007** (100% auto-create): Addressed in T006 (default config init)
- **SC-008** (95% discoverability): Addressed in T014, T056 (visibility, indicators)
