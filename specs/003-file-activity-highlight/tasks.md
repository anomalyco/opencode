# Tasks: File Activity Highlight

**Input**: Design documents from `/specs/003-file-activity-highlight/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: No test tasks included (not requested in specification)

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4)
- Include exact file paths in descriptions

## Path Conventions

- **Monorepo**: `packages/app/src/` for app code, `packages/ui/src/` for UI components

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and type definitions

- [x] T001 [P] Create FileActivityType and FileActivityState types in packages/app/src/types/file-activity.ts
- [x] T002 [P] Create FileActivityStore interface in packages/app/src/types/file-activity.ts
- [x] T003 [P] Create ActivityVisualConfig type and ACTIVITY_VISUAL_CONFIG constant in packages/app/src/types/file-activity.ts
- [x] T004 [P] Create TOOL_ACTIVITY_MAP constant for tool-to-activity mapping in packages/app/src/types/file-activity.ts

**Checkpoint**: Type definitions ready - context implementation can begin

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core activity tracking context that MUST be complete before any user story UI work

**⚠️ CRITICAL**: No user story UI tasks can begin until this phase is complete

- [x] T005 Create FileActivityProvider using createSimpleContext pattern in packages/app/src/context/file-activity.tsx
- [x] T006 Implement createStore for FileActivityStore in packages/app/src/context/file-activity.tsx
- [x] T007 Subscribe to message.part.updated events in file-activity.tsx context
- [x] T008 Implement extractFilePath helper to get path from ToolPart.state.input in packages/app/src/context/file-activity.tsx
- [x] T009 Implement recordActivity function with precedence logic (read < edited < created) in packages/app/src/context/file-activity.tsx
- [x] T010 Implement handleSessionChange to clear activity when session changes in packages/app/src/context/file-activity.tsx
- [x] T011 Implement get(path) method to retrieve activity state for a file in packages/app/src/context/file-activity.tsx
- [x] T012 Implement has(path) method to check if file has activity in packages/app/src/context/file-activity.tsx
- [x] T013 Export useFileActivity hook from packages/app/src/context/file-activity.tsx
- [x] T014 Add FileActivityProvider wrapper in packages/app/src/pages/directory-layout.tsx

**Checkpoint**: Foundation ready - activity tracking is functional, user story UI work can begin

---

## Phase 3: User Story 1 - View Files Read by AI (Priority: P1) 🎯 MVP

**Goal**: Display visual highlighting for files read by the AI model with "read" badge

**Independent Test**: Trigger an AI file read operation and verify the file appears highlighted in the file explorer with a green "read" indicator

### Implementation for User Story 1

- [x] T015 [P] [US1] Create FileActivityBadge component in packages/app/src/components/file-activity-badge.tsx
- [x] T016 [P] [US1] Import useFileActivity in packages/app/src/components/file-tree.tsx
- [x] T017 [US1] Add activity state lookup for each file node in packages/app/src/components/file-tree.tsx
- [x] T018 [US1] Add conditional background styling for read activity type in file-tree.tsx classList
- [x] T019 [US1] Add conditional border-left styling for read activity type in file-tree.tsx classList
- [x] T020 [US1] Render FileActivityBadge after filename for files with "read" activity in packages/app/src/components/file-tree.tsx
- [x] T021 [US1] Ensure "Read" tool events update activity store with type "read" in packages/app/src/context/file-activity.tsx

**Checkpoint**: User Story 1 complete - files read by AI show green highlight with "read" badge

---

## Phase 4: User Story 2 - View Files Written/Edited by AI (Priority: P1)

**Goal**: Display visual highlighting for files edited or created by the AI model with "edited" or "created" badges

**Independent Test**: Trigger an AI file edit/write operation and verify the file appears highlighted with red "edited" or orange "created" indicator

### Implementation for User Story 2

- [x] T022 [US2] Ensure "Edit" tool events update activity store with type "edited" in packages/app/src/context/file-activity.tsx
- [x] T023 [US2] Ensure "Write" tool events check file existence to set "edited" vs "created" in packages/app/src/context/file-activity.tsx
- [x] T024 [US2] Add conditional background styling for edited activity type in file-tree.tsx classList
- [x] T025 [US2] Add conditional background styling for created activity type in file-tree.tsx classList
- [x] T026 [US2] Add conditional border-left styling for edited and created activity types in file-tree.tsx classList
- [x] T027 [US2] Render FileActivityBadge with correct type for edited/created files in packages/app/src/components/file-tree.tsx

**Checkpoint**: User Story 2 complete - files edited/created by AI show appropriate colored highlights and badges

---

## Phase 5: User Story 3 - Distinguish Between Activity Types (Priority: P2)

**Goal**: Ensure users can clearly distinguish between read, edited, and created files through visual differentiation

**Independent Test**: Have AI read some files and write others, verify visual indicators clearly differentiate between activity types

### Implementation for User Story 3

- [x] T028 [US3] Verify color contrast meets accessibility standards (WCAG AA) for all three activity types
- [x] T029 [US3] Implement getDirectoryActivity method using createMemo for aggregated directory indicators in packages/app/src/context/file-activity.tsx
- [x] T030 [US3] Add activity indicator to collapsed directory nodes showing highest-precedence child activity in packages/app/src/components/file-tree.tsx
- [x] T031 [US3] Implement activity precedence update logic (read→edited upgrade when file is first read then edited) in packages/app/src/context/file-activity.tsx
- [x] T032 [US3] Add Tooltip to FileActivityBadge explaining activity type meaning in packages/app/src/components/file-activity-badge.tsx

**Checkpoint**: User Story 3 complete - all activity types are clearly distinguishable, directories show aggregated indicators

---

## Phase 6: User Story 4 - Clear Activity State for New Session (Priority: P3)

**Goal**: Activity highlights clear automatically when a new AI session begins

**Independent Test**: Have activity highlights from one session, start a new session, verify all highlights are cleared

### Implementation for User Story 4

- [x] T033 [US4] Detect session changes by comparing sessionId from ToolPart events in packages/app/src/context/file-activity.tsx
- [x] T034 [US4] Call clear() to reset files store when session ID changes in packages/app/src/context/file-activity.tsx
- [x] T035 [US4] Verify activity state persists during file explorer refresh within same session
- [x] T036 [US4] Ensure new session activities are tracked correctly after clear

**Checkpoint**: User Story 4 complete - activity state properly scoped to current session

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Edge cases and improvements that affect multiple user stories

- [x] T037 [P] Handle file deletion edge case - remove activity when file is deleted in packages/app/src/context/file-activity.tsx
- [x] T038 [P] Handle file rename/move edge case - update activity path when file moves in packages/app/src/context/file-activity.tsx
- [x] T039 [P] Ensure NotebookEdit tool is mapped to "edited" activity type
- [x] T040 Code cleanup - remove any console.log statements added during development
- [x] T041 Run quickstart.md validation steps to verify all scenarios work

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-6)**: All depend on Foundational phase completion
  - US1 (P1) and US2 (P1) can proceed in parallel after Foundational
  - US3 (P2) depends on US1 and US2 being complete (to verify differentiation)
  - US4 (P3) can start after Foundational but is lowest priority
- **Polish (Phase 7)**: Depends on all user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 3 (P2)**: Best after US1 and US2 to verify visual differentiation works
- **User Story 4 (P3)**: Can start after Foundational (Phase 2) - Independent of other stories

### Within Each User Story

- Models/types before context methods
- Context methods before component integration
- Core implementation before edge cases

### Parallel Opportunities

- All Setup tasks (T001-T004) can run in parallel
- US1 badge component (T015) and file-tree import (T016) can run in parallel
- US1 and US2 can be worked on in parallel by different developers
- All Polish tasks marked [P] can run in parallel

---

## Parallel Example: Setup Phase

```bash
# Launch all type definition tasks together:
Task: "Create FileActivityType and FileActivityState types in packages/app/src/types/file-activity.ts"
Task: "Create FileActivityStore interface in packages/app/src/types/file-activity.ts"
Task: "Create ActivityVisualConfig type and ACTIVITY_VISUAL_CONFIG constant in packages/app/src/types/file-activity.ts"
Task: "Create TOOL_ACTIVITY_MAP constant in packages/app/src/types/file-activity.ts"
```

## Parallel Example: User Story 1

```bash
# Launch badge component and import in parallel:
Task: "Create FileActivityBadge component in packages/app/src/components/file-activity-badge.tsx"
Task: "Import useFileActivity in packages/app/src/components/file-tree.tsx"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (30 min)
2. Complete Phase 2: Foundational (2 hours)
3. Complete Phase 3: User Story 1 (1 hour)
4. **STOP and VALIDATE**: Test file read highlighting independently
5. Deploy/demo if ready - users can already see which files AI has read

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Read indicators work → Demo MVP
3. Add User Story 2 → Edit/Create indicators work → Demo
4. Add User Story 3 → Visual differentiation clear → Demo
5. Add User Story 4 → Session isolation works → Demo
6. Each story adds value without breaking previous stories

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1 (read highlighting)
   - Developer B: User Story 2 (edit/create highlighting)
3. After US1+US2: Developer completes US3 (differentiation verification)
4. US4 can be done anytime after Foundational

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Activity state is session-scoped - no persistence needed
- Uses existing theme colors - no new design tokens required
