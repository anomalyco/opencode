# Automatic Theme Reloading in TUI

## TL;DR

> **Quick Summary**: Add a file watcher to the TUI's ThemeProvider that monitors `~/.config/opencode/themes/*.json` for changes and automatically reloads custom themes without requiring a restart or SIGUSR2 signal.
>
> **Deliverables**:
>
> - Modified `theme.tsx` with `@parcel/watcher` integration
> - New test file `theme-watcher.test.ts`
>
> **Estimated Effort**: Short
> **Parallel Execution**: YES - 2 waves
> **Critical Path**: Task 1 (watcher impl) → Task 2 (tests)

---

## Context

### Original Request

User wants automatic theme reloading when theme files in the XDG config themes directory are edited. Only watch `~/.config/opencode/themes/` — not project `.opencode/themes/` directories.

### Interview Summary

**Key Discussions**:

- Watch scope: XDG config themes folder only (Global.Path.config + "/themes")
- No need to watch project-level `.opencode/themes/` directories
- Automatic reload on add/change/delete of `.json` files

**Research Findings**:

- Theme loading: `packages/opencode/src/cli/cmd/tui/context/theme.tsx` — `getCustomThemes()` scans `themes/*.json` at startup only
- File watching: `@parcel/watcher` v2.5.1 already a dependency, used by server-side FileWatcher service
- TUI runs in separate process from Effect-based server, so must use `@parcel/watcher` directly
- Existing refresh mechanism: SIGUSR2 signal calls `refresh()` → `init()` (manual only)
- `customThemes` is a module-level `Record<string, ThemeJson>` merged via `syncThemes()` into Solid.js store
- `resolveTheme()` converts ThemeJson to RGBA colors; `createEffect` applies to renderer

### Metis Review

**Note**: Metis consultation timed out. Self-review applied below.

---

## Work Objectives

### Core Objective

Enable real-time theme reloading in the TUI when user edits theme JSON files in their XDG config themes directory.

### Concrete Deliverables

- `packages/opencode/src/cli/cmd/tui/context/theme.tsx` — watcher integration
- `packages/opencode/test/cli/tui/theme-watcher.test.ts` — test file

### Definition of Done

- [ ] Editing a theme JSON file in `~/.config/opencode/themes/` causes TUI to reload that theme within ~500ms
- [ ] Adding a new theme file causes it to appear in the theme list
- [ ] Deleting a theme file removes it from the theme list
- [ ] `bun test test/cli/tui/theme-watcher.test.ts` passes

### Must Have

- Watch `Global.Path.config/themes/` directory for `.json` file changes
- Debounce rapid file events (atomic writes)
- Clean up watcher on component unmount
- Handle directory not existing yet

### Must NOT Have (Guardrails)

- Do NOT watch project `.opencode/themes/` directories
- Do NOT watch plugin themes (managed separately via plugin lifecycle)
- Do NOT watch default themes (static imports)
- Do NOT introduce new dependencies (use existing `@parcel/watcher`)
- Do NOT modify the Effect-based FileWatcher service

---

## Verification Strategy

### Test Decision

- **Infrastructure exists**: YES
- **Automated tests**: YES (TDD)
- **Framework**: bun test
- **If TDD**: Each task follows RED (failing test) → GREEN (minimal impl) → REFACTOR

### QA Policy

Every task includes agent-executed QA scenarios. Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Tests**: `bun test` from `packages/opencode` directory
- **Manual verification**: Create/edit/delete theme file, observe TUI reload

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately - implementation):
└── Task 1: Add file watcher to ThemeProvider init [deep]

Wave 2 (After Wave 1 - tests):
└── Task 2: Write watcher tests [unspecified-high]

Wave FINAL (After ALL tasks — 4 parallel reviews, then user okay):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA (unspecified-high)
└── Task F4: Scope fidelity check (deep)
```

### Dependency Matrix

- **Task 1**: None → Blocks: Task 2
- **Task 2**: Depends on Task 1 → Blocks: Final wave

### Agent Dispatch Summary

- **Wave 1**: **1** — T1 → `deep`
- **Wave 2**: **1** — T2 → `unspecified-high`
- **FINAL**: **4** — F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

- [ ] 1. Add file watcher to ThemeProvider init

  **What to do**:
  - In `packages/opencode/src/cli/cmd/tui/context/theme.tsx`, add `@parcel/watcher` import
  - Inside the `ThemeProvider` init function (after `onMount(init)`), add a file watcher on `Global.Path.config + "/themes"`
  - Ensure the themes directory exists before subscribing (create if missing with `fs.mkdir`)
  - On watcher events (create/update/delete of `.json` files), call `getCustomThemes()` to reload, then `syncThemes()`
  - Debounce events with ~300ms window to handle atomic writes (editors that write to temp file then rename)
  - Add watcher cleanup in `onCleanup` alongside existing `renderer.off` and `process.off`
  - Use `Instance.bind()` pattern for the callback if needed for context, though TUI context may not need it

  **Must NOT do**:
  - Do NOT watch project `.opencode/themes/` directories
  - Do NOT modify the Effect-based FileWatcher service
  - Do NOT add new npm dependencies
  - Do NOT change the theme loading logic or ThemeJson format

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Requires understanding of Solid.js lifecycle, @parcel/watcher API, debounce patterns, and the existing theme module structure
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - `code-edit`: Standard file editing, no special pattern needed

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential (Wave 1)
  - **Blocks**: Task 2
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References** (existing code to follow):
  - `packages/opencode/src/cli/cmd/tui/context/theme.tsx:479-503` — `getCustomThemes()` function that reloads custom themes
  - `packages/opencode/src/cli/cmd/tui/context/theme.tsx:150-152` — `syncThemes()` that updates the store
  - `packages/opencode/src/cli/cmd/tui/context/theme.tsx:402-411` — Existing cleanup pattern with `onCleanup` (SIGUSR2 handler)
  - `packages/opencode/src/cli/cmd/tui/context/theme.tsx:331-345` — `init()` function that calls `getCustomThemes()` and `syncThemes()`
  - `packages/opencode/src/file/watcher.ts:98-105` — @parcel/watcher callback pattern with event type mapping
  - `packages/opencode/src/file/watcher.ts:107-119` — @parcel/watcher subscribe pattern with timeout handling

  **API/Type References** (contracts to implement against):
  - `packages/opencode/src/cli/cmd/tui/context/theme.tsx:78-86` — `ThemeJson` type definition
  - `packages/opencode/src/cli/cmd/tui/context/theme.tsx:124-130` — `State` store type
  - `packages/opencode/src/global/index.ts:15-26` — `Global.Path` with `config` property

  **External References** (libraries and frameworks):
  - `@parcel/watcher` API: `subscribe(directory, callback, options?)` returns `Promise<Subscription>` with `unsubscribe()` method
  - Callback signature: `(err: Error | null, events: Array<{type: 'create'|'update'|'delete', path: string}>) => void`

  **WHY Each Reference Matters**:
  - `theme.tsx:479-503` — This is the exact function to call on file change to reload custom themes
  - `theme.tsx:150-152` — This is the function to call after reloading to update the Solid.js store
  - `theme.tsx:402-411` — Shows the existing cleanup pattern to follow for the new watcher
  - `file/watcher.ts:98-105` — Shows how to map @parcel/watcher event types to application actions
  - `Global.Path.config` — The base path to watch (XDG config directory)

  **Acceptance Criteria**:
  - [ ] `@parcel/watcher` imported and subscribed to `Global.Path.config + "/themes"` in ThemeProvider init
  - [ ] On file change, `getCustomThemes()` re-reads and `syncThemes()` updates store
  - [ ] Events debounced with ~300ms window
  - [ ] Watcher unsubscribed on component cleanup
  - [ ] Handles case where themes directory doesn't exist yet (creates it or handles gracefully)
  - [ ] No new npm dependencies added

  **QA Scenarios**:

  ```
  Scenario: Edit existing theme file triggers reload
    Tool: interactive_bash (tmux)
    Preconditions: TUI running with a custom theme in ~/.config/opencode/themes/test.json
    Steps:
      1. Start TUI: `bun run --cwd packages/opencode src/cli/cmd/tui/index.ts`
      2. In another shell, modify the theme: `echo '{"theme":{"primary":"#ff0000"}}' > ~/.config/opencode/themes/test.json`
      3. Wait 500ms for debounce
      4. Open theme list dialog (Ctrl+K → "Switch theme")
    Expected Result: "test" theme appears in list with updated primary color
    Failure Indicators: Theme not in list, or primary color unchanged
    Evidence: .sisyphus/evidence/task-1-edit-theme-reload.png

  Scenario: New theme file added appears in list
    Tool: interactive_bash (tmux)
    Preconditions: TUI running, no custom themes in ~/.config/opencode/themes/
    Steps:
      1. Start TUI
      2. Create new theme: `echo '{"theme":{"primary":"#00ff00","text":"#ffffff","background":"#000000","backgroundElement":"#111111","border":"#333333","borderSubtle":"#222222","borderActive":"#444444","textMuted":"#aaaaaa","error":"#ff0000","warning":"#ffff00","success":"#00ff00","info":"#00ffff","accent":"#00ffff","secondary":"#ff00ff","diffAdded":"#00ff00","diffRemoved":"#ff0000","diffContext":"#888888","diffHunkHeader":"#666666","diffHighlightAdded":"#00ff00","diffHighlightRemoved":"#ff0000","diffContextBg":"#333333","diffLineNumber":"#555555","diffAddedLineNumberBg":"#003300","diffRemovedLineNumberBg":"#330000","markdownText":"#ffffff","markdownHeading":"#ffffff","markdownLink":"#0000ff","markdownLinkText":"#00ffff","markdownCode":"#00ff00","markdownBlockQuote":"#ffff00","markdownEmph":"#ffff00","markdownStrong":"#ffffff","markdownHorizontalRule":"#888888","markdownListItem":"#0000ff","markdownListEnumeration":"#00ffff","markdownImage":"#0000ff","markdownImageText":"#00ffff","markdownCodeBlock":"#ffffff","syntaxComment":"#888888","syntaxKeyword":"#ff00ff","syntaxFunction":"#0000ff","syntaxVariable":"#ffffff","syntaxString":"#00ff00","syntaxNumber":"#ffff00","syntaxType":"#00ffff","syntaxOperator":"#00ffff","syntaxPunctuation":"#ffffff"}}' > ~/.config/opencode/themes/newtheme.json`
      3. Wait 500ms
      4. Open theme list dialog
    Expected Result: "newtheme" appears in theme list
    Failure Indicators: Theme not in list
    Evidence: .sisyphus/evidence/task-1-new-theme-added.png

  Scenario: Delete theme file removes from list
    Tool: interactive_bash (tmux)
    Preconditions: TUI running with custom theme ~/.config/opencode/themes/test.json
    Steps:
      1. Start TUI, confirm "test" theme is in list
      2. Delete theme file: `rm ~/.config/opencode/themes/test.json`
      3. Wait 500ms
      4. Open theme list dialog
    Expected Result: "test" theme no longer in list
    Failure Indicators: Theme still in list
    Evidence: .sisyphus/evidence/task-1-delete-theme-removed.png

  Scenario: Debounce handles rapid file events
    Tool: Bash (curl)
    Preconditions: None (unit-level test)
    Steps:
      1. Write a test that simulates 10 rapid file change events within 100ms
      2. Verify getCustomThemes() is called only once (or at most twice due to debounce timing)
    Expected Result: Reload triggered at most once for the batch of rapid events
    Failure Indicators: Reload triggered 10 times (once per event)
    Evidence: .sisyphus/evidence/task-1-debounce-rapid-events.txt

  Scenario: Watcher cleanup on unmount
    Tool: Bash (bun test)
    Preconditions: Test environment
    Steps:
      1. Render ThemeProvider, verify watcher is subscribed
      2. Unmount ThemeProvider
      3. Verify watcher.unsubscribe() was called
    Expected Result: No errors after unmount, watcher properly cleaned up
    Failure Indicators: Memory leak warning, or watcher still active after unmount
    Evidence: .sisyphus/evidence/task-1-watcher-cleanup.txt
  ```

  **Evidence to Capture**:
  - [ ] Screenshot of theme list showing reloaded theme after edit
  - [ ] Screenshot of theme list showing new theme after add
  - [ ] Screenshot of theme list showing theme removed after delete
  - [ ] Test output showing debounce behavior
  - [ ] Test output showing cleanup

  **Commit**: YES (groups with 2)
  - Message: `feat(tui): auto-reload custom themes on file change`
  - Files: `packages/opencode/src/cli/cmd/tui/context/theme.tsx`, `packages/opencode/test/cli/tui/theme-watcher.test.ts`
  - Pre-commit: `bun test test/cli/tui/theme-watcher.test.ts` from packages/opencode

---

- [ ] 2. Write watcher tests

  **What to do**:
  - Create `packages/opencode/test/cli/tui/theme-watcher.test.ts`
  - Test that adding a new theme file to the watched directory causes it to appear in `allThemes()`
  - Test that modifying an existing theme file updates the theme in `allThemes()`
  - Test that deleting a theme file removes it from `allThemes()`
  - Use the existing test patterns from `theme-store.test.ts` as reference
  - Tests should use a temporary directory (not actual ~/.config/opencode/themes/) — set up a test-specific config path

  **Must NOT do**:
  - Do NOT test against the real ~/.config/opencode/themes/ directory
  - Do NOT test the Effect-based FileWatcher service
  - Do NOT duplicate existing theme-store.test.ts tests

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Requires understanding of Solid.js testing patterns, file system mocking, and the theme module's test infrastructure
  - **Skills**: `[]`
  - **Skills Evaluated but Omitted**:
    - `code-edit`: Standard test writing

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Sequential (Wave 2)
  - **Blocks**: Final verification wave
  - **Blocked By**: Task 1

  **References**:

  **Pattern References** (existing code to follow):
  - `packages/opencode/test/cli/tui/theme-store.test.ts` — Existing theme test patterns, dynamic import style
  - `packages/opencode/test/fixture/fixture.ts` — tmpdir fixture for temporary directories
  - `packages/opencode/src/cli/cmd/tui/context/theme.tsx:479-503` — `getCustomThemes()` function to verify behavior

  **Test References**:
  - `packages/opencode/test/cli/tui/theme-store.test.ts:1-51` — Shows dynamic import pattern for theme module and test structure

  **WHY Each Reference Matters**:
  - `theme-store.test.ts` — Shows how to dynamically import the theme module and test its functions
  - `fixture.ts` — Provides tmpdir for creating isolated test directories
  - `getCustomThemes()` — The function whose behavior we're testing

  **Acceptance Criteria**:
  - [ ] Test file created: `packages/opencode/test/cli/tui/theme-watcher.test.ts`
  - [ ] `bun test test/cli/tui/theme-watcher.test.ts` → PASS (all tests, 0 failures)
  - [ ] At least 3 test cases: add, modify, delete

  **QA Scenarios**:

  ```
  Scenario: All watcher tests pass
    Tool: Bash (bun test)
    Preconditions: Task 1 implementation complete
    Steps:
      1. Run: `bun test test/cli/tui/theme-watcher.test.ts` from packages/opencode directory
    Expected Result: All tests pass, 0 failures
    Failure Indicators: Any test failure or timeout
    Evidence: .sisyphus/evidence/task-2-all-tests-pass.txt
  ```

  **Evidence to Capture**:
  - [ ] Test output showing all tests passing

  **Commit**: YES (groups with 1)
  - Message: `feat(tui): auto-reload custom themes on file change`
  - Files: `packages/opencode/src/cli/cmd/tui/context/theme.tsx`, `packages/opencode/test/cli/tui/theme-watcher.test.ts`
  - Pre-commit: `bun test test/cli/tui/theme-watcher.test.ts` from packages/opencode

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Present consolidated results to user and get explicit "okay" before completing.
>
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before marking work complete.**
> **Never mark F1-F4 as checked before getting user's okay.** Rejection or user feedback -> fix -> re-run -> present again -> wait for okay.

- [ ] F1. **Plan Compliance Audit** — `oracle`
      Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, check watcher subscription). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
      Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
      Run `bun typecheck` from packages/opencode. Review changed files for: `as any`, `@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names.
      Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high`
      Start from clean state. Execute EVERY QA scenario from EVERY task — follow exact steps, capture evidence. Test cross-task integration. Test edge cases: empty state, invalid input, rapid actions. Save to `.sisyphus/evidence/final-qa/`.
      Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
      For each task: read "What to do", read actual diff (git log/diff). Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance. Detect cross-task contamination. Flag unaccounted changes.
      Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **1+2**: `feat(tui): auto-reload custom themes on file change` — theme.tsx, theme-watcher.test.ts, bun test test/cli/tui/theme-watcher.test.ts

---

## Success Criteria

### Verification Commands

```bash
cd packages/opencode && bun test test/cli/tui/theme-watcher.test.ts  # Expected: all tests pass
cd packages/opencode && bun typecheck  # Expected: no type errors
```

### Final Checklist

- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All tests pass
- [ ] Type checking passes
- [ ] No new dependencies added
