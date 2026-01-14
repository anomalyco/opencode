# Tasks: File Preview Viewer

**Input**: Design documents from `/specs/002-file-preview-viewer/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Not explicitly requested - test tasks omitted.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

Based on plan.md structure (monorepo):
- **Main app**: `packages/app/src/`
- **UI components**: `packages/ui/src/`
- **Feature components**: `packages/app/src/components/file-preview/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create component structure and shared utilities

- [x] T001 Create file-preview directory at packages/app/src/components/file-preview/
- [x] T002 [P] Create types and constants file at packages/app/src/components/file-preview/types.ts with PreviewType, PreviewError, SUPPORTED_EXTENSIONS, SIZE_LIMITS constants
- [x] T003 [P] Create utility functions file at packages/app/src/components/file-preview/utils.ts with getPreviewType(), validateContent(), isBinaryContent() functions

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Create the main FilePreview container component that routes to type-specific renderers

**⚠️ CRITICAL**: The main container must exist before individual preview types can be integrated

- [x] T004 Create FilePreview container component at packages/app/src/components/file-preview/file-preview.tsx with:
  - Props: file (LocalFile | null), class, onClose
  - Loading state management
  - Error state display
  - Type detection and routing to sub-components
  - Expand/collapse functionality
- [x] T005 Create file-preview CSS styles at packages/app/src/components/file-preview/file-preview.css with panel styling, header, content area
- [x] T006 Create index barrel export at packages/app/src/components/file-preview/index.ts

**Checkpoint**: Foundation ready - FilePreview shell exists, user story implementation can begin

---

## Phase 3: User Story 1 - View Text File Content (Priority: P1) 🎯 MVP

**Goal**: Users can click .txt files and see plain text content in a preview panel

**Independent Test**: Click any .txt file in file explorer → content displays in preview panel with monospace font and scrolling

### Implementation for User Story 1

- [x] T007 [US1] Create TextPreview component at packages/app/src/components/file-preview/text-preview.tsx with:
  - Props: content (string), truncated (boolean)
  - Monospace font styling
  - Preserved whitespace (white-space: pre-wrap)
  - Scrollable container
  - Truncation indicator when content exceeded 100KB
- [x] T008 [US1] Add text preview styles to packages/app/src/components/file-preview/file-preview.css for text-preview data-component
- [x] T009 [US1] Integrate TextPreview into FilePreview container at packages/app/src/components/file-preview/file-preview.tsx - add conditional rendering for previewType === 'text'
- [x] T010 [US1] Modify WorkspaceSidebar at packages/app/src/components/workspace-sidebar.tsx to:
  - Add previewFile signal state
  - Handle file click to set preview file
  - Render FilePreview component below FileTree
  - Load file content via local.file.load() when preview file changes
- [x] T011 [US1] Add empty file handling in FilePreview - display "This file is empty" message when content is empty string
- [x] T012 [US1] Add unsupported file message in FilePreview - display "Preview not available for this file type" when previewType is null

**Checkpoint**: User Story 1 complete - .txt file preview works independently

---

## Phase 4: User Story 2 - View Rendered Markdown (Priority: P2)

**Goal**: Users can click .md files and see rendered markdown with headings, lists, code blocks, links

**Independent Test**: Click any .md file → content displays with rendered formatting (headings have hierarchy, code blocks are styled)

### Implementation for User Story 2

- [x] T013 [US2] Integrate existing Markdown component from packages/ui/src/components/markdown.tsx into FilePreview routing at packages/app/src/components/file-preview/file-preview.tsx - add conditional rendering for previewType === 'markdown'
- [x] T014 [US2] Add markdown preview wrapper styles to packages/app/src/components/file-preview/file-preview.css for markdown content area (scrollable, proper spacing)
- [x] T015 [US2] Add .markdown extension support to getPreviewType() utility in packages/app/src/components/file-preview/utils.ts

**Checkpoint**: User Story 2 complete - .md file preview works independently

---

## Phase 5: User Story 3 - View Rendered HTML (Priority: P3)

**Goal**: Users can click .html/.htm files and see rendered HTML in sandboxed iframe (no script execution)

**Independent Test**: Click any .html file → content displays as rendered web page, scripts do NOT execute

### Implementation for User Story 3

- [x] T016 [US3] Create HtmlPreview component at packages/app/src/components/file-preview/html-preview.tsx with:
  - Props: content (string), basePath (string)
  - Sandboxed iframe with sandbox="allow-same-origin" attribute
  - Use srcdoc for content embedding
  - DOMPurify sanitization before rendering
  - Full-width/height iframe styling
- [x] T017 [US3] Add HTML preview styles to packages/app/src/components/file-preview/file-preview.css for iframe container (no border, full dimensions)
- [x] T018 [US3] Integrate HtmlPreview into FilePreview container at packages/app/src/components/file-preview/file-preview.tsx - add conditional rendering for previewType === 'html'
- [x] T019 [US3] Add DOMPurify import and sanitization to html-preview.tsx - sanitize content before passing to srcdoc

**Checkpoint**: User Story 3 complete - .html file preview works independently with security

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Error handling, edge cases, and refinements across all preview types

- [x] T020 [P] Add binary file detection in validateContent() at packages/app/src/components/file-preview/utils.ts - check first 8KB for null bytes
- [x] T021 [P] Add file size validation in FilePreview at packages/app/src/components/file-preview/file-preview.tsx - show error for files > 5MB, warning for files > 1MB
- [x] T022 [P] Add loading spinner/state in FilePreview at packages/app/src/components/file-preview/file-preview.tsx while file content is being loaded
- [x] T023 [P] Add file-not-found error handling in FilePreview - display error message when file read fails
- [x] T024 Add keyboard support in WorkspaceSidebar at packages/app/src/components/workspace-sidebar.tsx - Escape key to close preview panel
- [x] T025 Add preview panel collapse/expand toggle button in FilePreview header at packages/app/src/components/file-preview/file-preview.tsx
- [x] T026 Manual testing: Verify all acceptance scenarios from spec.md work correctly

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-5)**: All depend on Foundational phase completion
  - User stories can proceed in priority order (P1 → P2 → P3)
  - Each story adds one preview type capability
- **Polish (Phase 6)**: Depends on all user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories. Establishes core click-to-preview pattern.
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - Uses same FilePreview container, adds markdown routing. Independent of US1.
- **User Story 3 (P3)**: Can start after Foundational (Phase 2) - Uses same FilePreview container, adds HTML routing. Independent of US1/US2.

### Within Each User Story

- Component creation before integration
- Styles alongside components
- Integration into parent containers last

### Parallel Opportunities

- T002, T003 can run in parallel (different files)
- T007-T012 must be sequential (US1 builds up)
- T013-T015 can start after T004 (uses same container)
- T016-T019 can start after T004 (uses same container)
- T020, T021, T022, T023 can all run in parallel (different aspects)

---

## Parallel Example: Setup Phase

```bash
# Launch all setup tasks together:
Task: "Create types.ts with PreviewType, PreviewError, constants"
Task: "Create utils.ts with getPreviewType(), validateContent()"
```

## Parallel Example: Polish Phase

```bash
# Launch all polish tasks together:
Task: "Add binary file detection in utils.ts"
Task: "Add file size validation in FilePreview"
Task: "Add loading spinner in FilePreview"
Task: "Add file-not-found error handling"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001-T003)
2. Complete Phase 2: Foundational (T004-T006)
3. Complete Phase 3: User Story 1 (T007-T012)
4. **STOP and VALIDATE**: Click .txt file → preview shows content
5. Deploy/demo if ready - basic file preview works!

### Incremental Delivery

1. Complete Setup + Foundational → Preview shell exists
2. Add User Story 1 → .txt files work → Deploy/Demo (MVP!)
3. Add User Story 2 → .md files work → Deploy/Demo
4. Add User Story 3 → .html files work → Deploy/Demo
5. Add Polish → Better error handling, edge cases

### File Summary

| File | Action | Phase |
|------|--------|-------|
| packages/app/src/components/file-preview/types.ts | CREATE | Setup |
| packages/app/src/components/file-preview/utils.ts | CREATE | Setup |
| packages/app/src/components/file-preview/file-preview.tsx | CREATE | Foundational |
| packages/app/src/components/file-preview/file-preview.css | CREATE | Foundational |
| packages/app/src/components/file-preview/index.ts | CREATE | Foundational |
| packages/app/src/components/file-preview/text-preview.tsx | CREATE | US1 |
| packages/app/src/components/workspace-sidebar.tsx | MODIFY | US1 |
| packages/app/src/components/file-preview/html-preview.tsx | CREATE | US3 |

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story adds one file type support independently
- Reuses existing Markdown component from packages/ui (no new dependency)
- DOMPurify already available in project for HTML sanitization
- No tests included (not explicitly requested in spec)
