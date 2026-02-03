## App E2E Smoke Suite (CI)

Implement a small set of high-signal, low-flake Playwright tests to run in CI.

These tests are intended to catch regressions in the “core shell” of the app (navigation, dialogs, prompt UX, file viewer, terminal), without relying on model output.

---

### Summary

Add 6 smoke tests to `packages/app/e2e/`:

- Settings dialog: open, switch tabs, close
- Prompt slash command: `/open` opens the file picker dialog
- Prompt @mention: `@<file>` inserts a file pill token
- Model picker: open model selection and choose a model
- File viewer: open a known file and assert contents render
- Terminal: open terminal, verify Ghostty mounts, create a second terminal

---

### Progress

- [x] 1. Settings dialog open / switch / close (`packages/app/e2e/settings.spec.ts`)
- [x] 2. Prompt slash command path: `/open` opens file picker (`packages/app/e2e/prompt-slash-open.spec.ts`)
- [x] 3. Prompt @mention inserts a file pill token (`packages/app/e2e/prompt-mention.spec.ts`)
- [x] 4. Model selection UI works end-to-end (`packages/app/e2e/model-picker.spec.ts`)
- [x] 5. File viewer renders real file content (`packages/app/e2e/file-viewer.spec.ts`)
- [x] 8. Terminal init + create new terminal (`packages/app/e2e/terminal-init.spec.ts`)

---

### Goals

- Tests run reliably in CI using the existing local runner (`packages/app/script/e2e-local.ts`).
- Cover “wiring” regressions across UI + backend APIs:
  - dialogs + command routing
  - prompt contenteditable parsing
  - file search + file read + code viewer render
  - terminal open + pty creation + Ghostty mount
- Avoid assertions that depend on LLM output.
- Keep runtime low (these should be “smoke”, not full workflows).

---

### Non-goals

- Verifying complex model behavior, streaming correctness, or tool call semantics.
- Testing provider auth flows (CI has no secrets).
- Testing share, MCP, or LSP download flows (disabled in the e2e runner).

---

### Current State

Existing tests in `packages/app/e2e/` already cover:

- Home renders + server picker opens
- Directory route redirects to `/session`
- Sidebar collapse/expand
- Command palette opens/closes
- Basic session open + prompt input + (optional) prompt/reply flow
- File open via palette (but shallow assertion: tab exists)
- Terminal panel toggles (but doesn’t assert Ghostty mounted)
- Context panel open

We want to add a focused smoke layer that increases coverage of the most regression-prone UI paths.

---

### Proposed Tests

All tests should use the shared fixtures in:

- `packages/app/e2e/fixtures.ts` (for `sdk`, `directory`, `gotoSession`)
- `packages/app/e2e/utils.ts` (for `modKey`, `promptSelector`, `terminalToggleKey`)

Prefer creating new spec files rather than overloading existing ones, so it’s easy to run these tests as a group via grep.

Suggested file layout:

- `packages/app/e2e/settings.spec.ts`
- `packages/app/e2e/prompt-slash-open.spec.ts`
- `packages/app/e2e/prompt-mention.spec.ts`
- `packages/app/e2e/model-picker.spec.ts`
- `packages/app/e2e/file-viewer.spec.ts`
- `packages/app/e2e/terminal-init.spec.ts`

Name each test with a “smoke” prefix so CI can run only this suite if needed.

#### 1) Settings dialog open / switch / close

Purpose: catch regressions in dialog infra, settings rendering, tabs.

Steps:

1. `await gotoSession()`.
2. Open settings via keybind (preferred for stability): `await page.keyboard.press(`${modKey}+Comma`)`.
3. Assert dialog visible (`page.getByRole('dialog')`).
4. Click the "Shortcuts" tab (role `tab`, name "Shortcuts").
5. Assert shortcuts view renders (e.g. the search field placeholder or reset button exists).
6. Close with `Escape` and assert dialog removed.

Notes:

- If `Meta+Comma` / `Control+Comma` key name is flaky, fall back to clicking the sidebar settings icon.
- Favor role-based selectors over brittle class selectors.
- If `Escape` doesn’t dismiss reliably (tooltips can intercept), fall back to clicking the dialog overlay.

Implementation: `packages/app/e2e/settings.spec.ts`

Acceptance criteria:

- Settings dialog opens reliably.
- Switching to Shortcuts tab works.
- Escape closes the dialog.

#### 2) Prompt slash command path: `/open` opens file picker

Purpose: validate contenteditable parsing + slash popover + builtin command dispatch (distinct from `mod+p`).

Steps:

1. `await gotoSession()`.
2. Click prompt (`promptSelector`).
3. Type `/open`.
4. Press `Enter` (while slash popover is active).
5. Assert a dialog appears and contains a textbox (the file picker search input).
6. Close dialog with `Escape`.

Acceptance criteria:

- `/open` triggers `file.open` and opens `DialogSelectFile`.

#### 3) Prompt @mention inserts a file pill token

Purpose: validate the most fragile prompt behavior: structured tokens inside contenteditable.

Steps:

1. `await gotoSession()`.
2. Focus the prompt.
3. Type `@packages/app/package.json`.
4. Press `Tab` to accept the active @mention suggestion.
5. Assert a pill element is inserted:
   - `page.locator('[data-component="prompt-input"] [data-type="file"][data-path="packages/app/package.json"]')` exists.

Acceptance criteria:

- A file pill is inserted and has the expected `data-*` attributes.
- Prompt editor remains interactable (e.g. typing a trailing space works).

#### 4) Model selection UI works end-to-end

Purpose: validate model list rendering, selection wiring, and prompt footer updating.

Implementation approach:

- Use `/model` to open the model selection dialog (builtin command).

Steps:

1. `await gotoSession()`.
2. Focus prompt, type `/model`, press `Enter`.
3. In the model dialog, pick a visible model that is not the current selection (if available).
4. Use the search field to filter to that model (use its id from the list item's `data-key` to avoid time-based model visibility drift).
5. Select the filtered model.
6. Assert dialog closed.
7. Assert the prompt footer now shows the chosen model name.

Acceptance criteria:

- A model can be selected without requiring provider auth.
- The prompt footer reflects the new selection.

#### 5) File viewer renders real file content

Purpose: ensure file search + open + file.read + code viewer render all work.

Steps:

1. `await gotoSession()`.
2. Open file picker (either `mod+p` or `/open`).
3. Search for `packages/app/package.json`.
4. Click the matching file result.
5. Ensure the new file tab is active (click the `package.json` tab if needed so the viewer mounts).
6. Assert the code viewer contains a known substring:
   - `"name": "@opencode-ai/app"`.
7. Optionally assert the file tab is active and visible.

Acceptance criteria:

- Code view shows expected content (not just “tab exists”).

#### 8) Terminal init + create new terminal

Purpose: ensure terminal isn’t only “visible”, but actually mounted and functional.

Steps:

1. `await gotoSession()`.
2. Open terminal with `terminalToggleKey` (currently `Control+Backquote`).
3. Assert terminal container exists and is visible: `[data-component="terminal"]`.
4. Assert Ghostty textarea exists: `[data-component="terminal"] textarea`.
5. Create a new terminal via keybind (`terminal.new` is `ctrl+alt+t`).
6. Assert terminal tab count increases to 2.

Acceptance criteria:

- Ghostty mounts (textarea present).
- Creating a new terminal results in a second tab.

---

### CI Stability + Flake Avoidance

These tests run with `fullyParallel: true` in `packages/app/playwright.config.ts`. Keep them isolated and deterministic.

- Avoid ordering-based assertions: never assume a “first” session/project/file is stable unless you filtered by unique text.
- Prefer deterministic targets:
  - use `packages/app/package.json` rather than bare `package.json` (multiple hits possible)
  - for models, avoid hardcoding a single model id; pick from the visible list and filter by its `data-key` instead
- Prefer robust selectors:
  - role selectors: `getByRole('dialog')`, `getByRole('textbox')`, `getByRole('tab')`
  - stable data attributes already present: `promptSelector`, `[data-component="terminal"]`
- Keep tests local and fast:
  - do not submit prompts that require real model replies
  - avoid `page.waitForTimeout`; use `expect(...).toBeVisible()` and `expect.poll` when needed
- Watch for silent UI failures:
  - capture `page.on('pageerror')` and fail test if any are emitted
  - optionally capture console errors (`page.on('console', ...)`) and fail on `type==='error'`
- Cleanup:
  - these tests should not need to create sessions
  - if a test ever creates sessions or PTYs directly, clean up with SDK calls in `finally`

---

### Validation Plan

Run locally:

- `cd packages/app`
- `bun run test:e2e:local -- --grep smoke`

Verify:

- all new tests pass consistently across multiple runs
- overall e2e suite time does not increase significantly

---

### Open Questions

- Should we add a small helper in `packages/app/e2e/utils.ts` for “type into prompt contenteditable” to reduce duplication?
- Do we want to gate these smoke tests with a dedicated `@smoke` naming convention (or `test.describe('smoke', ...)`) so CI can target them explicitly?
