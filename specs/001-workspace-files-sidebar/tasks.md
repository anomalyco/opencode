# Tasks: Workspace Files Sidebar

**Input**: Design documents from `/specs/001-workspace-files-sidebar/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Not explicitly requested in the feature specification - test tasks omitted.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Monorepo**: `packages/app/src/`, `packages/ui/src/`
- Layout context: `packages/app/src/context/layout.tsx`
- Pages: `packages/app/src/pages/`
- Components: `packages/app/src/components/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Layout context extension for sidebar state management

- [x] T001 Add `workspaceSidebar` state to store in `packages/app/src/context/layout.tsx` with `opened: false` and `width: 300`
- [x] T002 Increment persist version from `layout.v6` to `layout.v7` in `packages/app/src/context/layout.tsx`
- [x] T003 Add `workspaceSidebar` API to layout context return object in `packages/app/src/context/layout.tsx` with `opened()`, `toggle()`, `width()`, `resize()` methods

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core component that MUST be complete before user stories can be fully integrated

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T004 Create `WorkspaceSidebar` component scaffold in `packages/app/src/components/workspace-sidebar.tsx` with props: `workspacePath: string`
- [x] T005 Add sidebar container with border-l styling and flex column layout in `packages/app/src/components/workspace-sidebar.tsx`
- [x] T006 Add sidebar header with "Files" title and close button in `packages/app/src/components/workspace-sidebar.tsx`
- [x] T007 Register command `workspaceSidebar.toggle` with keybind `mod+shift+e` in `packages/app/src/pages/layout.tsx` or `session.tsx`

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 - Browse Project Files (Priority: P1) 🎯 MVP

**Goal**: Display workspace folder contents as hierarchical file tree in secondary sidebar

**Independent Test**: Open a project, press `mod+shift+e`, verify file tree displays complete workspace structure with expandable/collapsible folders

### Implementation for User Story 1

- [x] T008 [US1] Import and integrate `FileTree` component in `packages/app/src/components/workspace-sidebar.tsx` with `path={props.workspacePath}`
- [x] T009 [US1] Add scrollable container for file tree with `flex-1 overflow-y-auto` in `packages/app/src/components/workspace-sidebar.tsx`
- [x] T010 [US1] Integrate `WorkspaceSidebar` into main layout in `packages/app/src/pages/layout.tsx` or `packages/app/src/pages/session.tsx`
- [x] T011 [US1] Add `<Show when={layout.workspaceSidebar.opened()}>` conditional rendering in layout
- [x] T012 [US1] Add `ResizeHandle` for sidebar width adjustment in layout integration (min: 200, max: 600)
- [x] T013 [US1] Connect `ResizeHandle` to `layout.workspaceSidebar.resize()` callback
- [x] T014 [US1] Apply responsive hiding with `hidden xl:flex` classes for desktop-only display
- [x] T015 [US1] Add empty state message when workspace folder contains no files in `packages/app/src/components/workspace-sidebar.tsx`

**Checkpoint**: User Story 1 complete - file tree browsing with expand/collapse works independently

---

## Phase 4: User Story 2 - Identify File Types Visually (Priority: P1)

**Goal**: Display recognizable icons for different file types (pdf, txt, md, images, code, etc.)

**Independent Test**: Create workspace with various file types, verify each displays correct distinctive icon

### Implementation for User Story 2

- [x] T016 [US2] Verify `FileTree` component uses `FileIcon` from `packages/ui/src/components/file-icon.tsx`
- [x] T017 [US2] Confirm icon sprite includes all required file types: pdf, doc/docx, txt, md, png/jpg/gif/svg, js/ts/py/rs, zip/tar/gz, mp3/mp4 in `packages/ui/public/file-icons/sprite.svg`
- [x] T018 [US2] Add any missing file type icons to sprite if needed (update `packages/ui/src/components/file-icon.tsx` ICON_MAPS)
- [x] T019 [US2] Style file icons with consistent sizing `w-4 h-4` and color `text-text-muted/60` in file tree nodes

**Checkpoint**: User Story 2 complete - all file types display recognizable icons

---

## Phase 5: User Story 3 - Toggle Secondary Sidebar Visibility (Priority: P2)

**Goal**: Allow users to show/hide sidebar with persisted state across sessions

**Independent Test**: Toggle sidebar visibility, close app, reopen - sidebar state should persist

### Implementation for User Story 3

- [x] T020 [US3] Add toggle button/icon in toolbar or header area in `packages/app/src/pages/layout.tsx`
- [x] T021 [US3] Connect toggle button to `layout.workspaceSidebar.toggle()` method
- [x] T022 [US3] Verify persistence by testing: toggle sidebar, refresh page, confirm state persists
- [x] T023 [US3] Add smooth CSS transition for sidebar show/hide animation in `packages/app/src/components/workspace-sidebar.tsx`

**Checkpoint**: User Story 3 complete - toggle and persistence work independently

---

## Phase 6: User Story 4 - Select and Interact with Files (Priority: P2)

**Goal**: Allow users to click files to select them with visual highlight and trigger actions

**Independent Test**: Click files, verify selection highlight, double-click/enter to activate

### Implementation for User Story 4

- [x] T024 [US4] Add `selectedFile` signal state in `packages/app/src/components/workspace-sidebar.tsx`
- [x] T025 [US4] Implement `onFileClick` callback in `FileTree` to update selection state
- [x] T026 [US4] Add visual highlight styles for selected file node (e.g., `bg-surface-raised-base`)
- [x] T027 [US4] Implement `onFileActivate` callback for double-click/Enter actions
- [x] T028 [US4] Connect file activation to application's file viewer/handler (if exists)
- [x] T029 [US4] Add Escape key handler to clear selection

**Checkpoint**: User Story 4 complete - file selection and activation work independently

---

## Phase 7: User Story 5 - View File Path Information (Priority: P3)

**Goal**: Display full file path tooltip on hover for deeply nested files

**Independent Test**: Hover over deeply nested file, verify tooltip shows complete path from workspace root

### Implementation for User Story 5

- [x] T030 [US5] Verify `FileTree` component already uses `Tooltip` for path display
- [x] T031 [US5] Configure tooltip delay to ~2 seconds for better UX in file tree node
- [x] T032 [US5] Ensure tooltip shows relative path from workspace root, not absolute system path
- [x] T033 [US5] Add text truncation with ellipsis for long file names in tree nodes

**Checkpoint**: User Story 5 complete - path tooltips work independently

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Accessibility, edge cases, and refinements

- [x] T034 Add keyboard navigation support: Arrow keys to navigate, Enter to expand/select in `packages/app/src/components/workspace-sidebar.tsx`
- [x] T035 [P] Add ARIA attributes: `role="tree"`, `aria-label="Workspace files"` for accessibility (FR-015, SC-006)
- [x] T036 [P] Add `role="treeitem"` and `aria-expanded` to folder nodes for screen reader support
- [x] T037 Verify styling consistency with primary sidebar: typography, colors, spacing
- [ ] T038 Test performance with 1000+ file workspace (SC-002: render < 1 second)
- [ ] T039 [P] Add mobile overlay pattern for `xl:hidden` breakpoint (future enhancement)
- [ ] T040 Run quickstart.md validation - verify all manual testing checklist items pass

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-7)**: All depend on Foundational phase completion
  - US1 and US2 are both P1 - can run in parallel
  - US3 and US4 are both P2 - can run in parallel after US1/US2
  - US5 is P3 - can run after US3/US4
- **Polish (Phase 8)**: Depends on all user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational - Core browsing functionality
- **User Story 2 (P1)**: Can start after Foundational - File icons (may run parallel with US1)
- **User Story 3 (P2)**: Can start after Foundational - Toggle visibility
- **User Story 4 (P2)**: Can start after US1 - Requires file tree to exist for selection
- **User Story 5 (P3)**: Can start after US1 - Requires file tree to exist for tooltips

### Within Each User Story

- Layout context changes before component changes
- Component scaffold before feature implementation
- Core implementation before styling refinements

### Parallel Opportunities

- **Phase 1**: T001, T002, T003 are sequential (same file)
- **Phase 2**: T004-T006 sequential (same file), T007 can be parallel
- **Phase 3+**: US1 and US2 can run in parallel (different concerns)
- **Phase 8**: T035, T036, T039 can run in parallel (different files/concerns)

---

## Parallel Example: User Stories 1 & 2

```bash
# These can run in parallel as they touch different concerns:

# User Story 1 - File tree integration:
Task: "Import and integrate FileTree component"
Task: "Add scrollable container for file tree"
Task: "Integrate WorkspaceSidebar into main layout"

# User Story 2 - File icons (parallel):
Task: "Verify FileTree uses FileIcon component"
Task: "Confirm icon sprite includes all required types"
```

---

## Implementation Strategy

### MVP First (User Stories 1 & 2 Only)

1. Complete Phase 1: Setup (layout context state)
2. Complete Phase 2: Foundational (component scaffold)
3. Complete Phase 3: User Story 1 (file tree browsing)
4. Complete Phase 4: User Story 2 (file icons)
5. **STOP and VALIDATE**: Test file browsing with icons independently
6. Deploy/demo if ready - this is the MVP!

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. Add US1 + US2 → Test independently → Deploy (MVP!)
3. Add US3 (toggle) → Test independently → Deploy
4. Add US4 (selection) → Test independently → Deploy
5. Add US5 (tooltips) → Test independently → Deploy
6. Polish phase → Final refinements → Release

### Single Developer Strategy

1. Complete Setup (T001-T003)
2. Complete Foundational (T004-T007)
3. User Story 1: T008-T015
4. User Story 2: T016-T019
5. User Story 3: T020-T023
6. User Story 4: T024-T029
7. User Story 5: T030-T033
8. Polish: T034-T040

---

## Notes

- This feature heavily reuses existing components: `FileTree`, `FileIcon`, `ResizeHandle`, `Tooltip`
- No new backend/API work required - all frontend
- Layout context pattern follows existing primary sidebar implementation
- Total: 40 tasks across 8 phases
- MVP scope: Phases 1-4 (20 tasks) - delivers browsable file tree with icons
