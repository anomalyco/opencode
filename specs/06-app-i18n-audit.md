# App i18n Audit (Remaining Work)

Scope: `packages/app/`

Date: 2026-01-20

This report documents the remaining user-facing strings in `packages/app/src` that are still hardcoded (not routed through `useLanguage().t(...)` / translation keys), plus i18n-adjacent issues like locale-sensitive formatting.

## Current State

- The app uses `useLanguage().t("...")` with dictionaries in `packages/app/src/i18n/en.ts` and `packages/app/src/i18n/zh.ts`.
- Recent progress (already translated): `packages/app/src/pages/home.tsx`, `packages/app/src/pages/layout.tsx`, `packages/app/src/pages/session.tsx`, `packages/app/src/components/prompt-input.tsx`, `packages/app/src/components/dialog-connect-provider.tsx`, `packages/app/src/components/session/session-header.tsx`, `packages/app/src/pages/error.tsx`, `packages/app/src/components/session/session-new-view.tsx`, `packages/app/src/components/session-context-usage.tsx`, `packages/app/src/components/session/session-context-tab.tsx`, `packages/app/src/components/session-lsp-indicator.tsx`, `packages/app/src/components/session/session-sortable-tab.tsx`, `packages/app/src/components/titlebar.tsx`, `packages/app/src/components/dialog-select-model.tsx`, `packages/app/src/context/notification.tsx`, `packages/app/src/context/global-sync.tsx`, `packages/app/src/context/file.tsx`, `packages/app/src/context/local.tsx`, `packages/app/src/utils/prompt.ts`, `packages/app/src/context/terminal.tsx`, `packages/app/src/components/session/session-sortable-terminal-tab.tsx` (plus new keys added in both dictionaries).
- Dictionary parity check: `en.ts` and `zh.ts` currently contain the same key set (373 keys each; no missing or extra keys).

## Methodology

- Scanned `packages/app/src` (excluding `packages/app/src/i18n/*` and tests).
- Grepped for:
  - Hardcoded JSX text nodes (e.g. `>Some text<`)
  - Hardcoded prop strings (e.g. `title="..."`, `placeholder="..."`, `label="..."`, `description="..."`, `Tooltip value="..."`)
  - Toast/notification strings, default fallbacks, and error message templates.
- Manually reviewed top hits to distinguish:
  - User-facing UI copy (needs translation)
  - Developer-only logs (`console.*`) (typically does not need translation)
  - Technical identifiers (e.g. `MCP`, `LSP`, URLs) (may remain untranslated by choice).

## Highest Priority: Pages

### 1) Error Page

File: `packages/app/src/pages/error.tsx`

Completed (2026-01-20):

- Localized page UI copy via `error.page.*` keys (title, description, buttons, report text, version label).
- Localized error chain framing and common init error templates via `error.chain.*` keys.
- Kept raw server/provider error messages as-is when provided (only localizing labels and structure).

## Highest Priority: Components

### 2) Prompt Input

File: `packages/app/src/components/prompt-input.tsx`

Completed (2026-01-20):

- Localized placeholder examples by replacing the hardcoded `PLACEHOLDERS` list with `prompt.example.*` keys.
- Localized toast titles/descriptions via `prompt.toast.*` and reused `common.requestFailed` for fallback error text.
- Localized popover empty states and drag/drop overlay copy (`prompt.popover.*`, `prompt.dropzone.label`).
- Localized smaller labels (slash "custom" badge, attach button tooltip, Send/Stop tooltip labels).
- Kept the `ESC` keycap itself untranslated (key label).

### 3) Provider Connection / Auth Flow

File: `packages/app/src/components/dialog-connect-provider.tsx`

Completed (2026-01-20):

- Localized all user-visible copy via `provider.connect.*` keys (titles, statuses, validations, instructions, OpenCode Zen onboarding).
- Added `common.submit` and used it for both API + OAuth submit buttons.
- Localized the success toast via `provider.connect.toast.connected.*`.

### 4) Session Header (Share/Publish UI)

File: `packages/app/src/components/session/session-header.tsx`

Completed (2026-01-20):

- Localized search placeholder via `session.header.search.placeholder`.
- Localized share/publish UI via `session.share.*` keys (popover title/description, button states, copy tooltip).
- Reused existing command keys for toggle/share tooltips (`command.review.toggle`, `command.terminal.toggle`, `command.session.share`).

## Medium Priority: Components

### 5) New Session View

File: `packages/app/src/components/session/session-new-view.tsx`

Completed (2026-01-20):

- Reused existing `command.session.new` for the heading.
- Localized worktree labels via `session.new.worktree.*` (main branch, main branch w/ branch name, create worktree).
- Localized "Last modified" via `session.new.lastModified` and used `language.locale()` for Luxon relative time.

### 6) Context Usage Tooltip

File: `packages/app/src/components/session-context-usage.tsx`

Completed (2026-01-20):

- Localized tooltip labels + CTA via `context.usage.*` keys.
- Switched currency and number formatting to the active locale (`language.locale()`).

### 7) Session Context Tab (Formatting)

File: `packages/app/src/components/session/session-context-tab.tsx`

Completed (2026-01-20):

- Switched currency formatting to the active locale (`language.locale()`).
- Also used `language.locale()` for number/date formatting.
- Note: "—" placeholders remain hardcoded; optional to localize.

### 8) LSP Indicator

File: `packages/app/src/components/session-lsp-indicator.tsx`

Completed (2026-01-20):

- Localized tooltip/label framing via `lsp.*` keys (kept the acronym itself).

### 9) Session Tab Close Tooltip

File: `packages/app/src/components/session/session-sortable-tab.tsx`

Completed (2026-01-20):

- Reused `common.closeTab` for the close tooltip.

### 10) Titlebar Tooltip

File: `packages/app/src/components/titlebar.tsx`

Completed (2026-01-20):

- Reused `command.sidebar.toggle` for the tooltip title.

### 11) Model Selection "Recent" Group

File: `packages/app/src/components/dialog-select-model.tsx`

Completed (2026-01-20):

- Removed the unused hardcoded "Recent" group comparisons to avoid locale-coupled sorting.

### 12) Select Server Dialog Placeholder (Optional)

File: `packages/app/src/components/dialog-select-server.tsx`

Completed (2026-01-20):

- Moved the placeholder example URL behind `dialog.server.add.placeholder` (value unchanged).

## Medium Priority: Context Modules

### 13) OS/Desktop Notifications

File: `packages/app/src/context/notification.tsx`

Completed (2026-01-20):

- Localized OS notification titles/fallback copy via `notification.session.*` keys.

### 14) Global Sync (Bootstrap Errors + Toast)

File: `packages/app/src/context/global-sync.tsx`

Completed (2026-01-20):

- Localized the sessions list failure toast via `toast.session.listFailed.title`.
- Localized the bootstrap connection error via `error.globalSync.connectFailed`.

### 15) File Load Failure Toast (Duplicate)

Files:

- `packages/app/src/context/file.tsx`
- `packages/app/src/context/local.tsx`

Completed (2026-01-20):

- Introduced `toast.file.loadFailed.title` and reused it in both contexts.

### 16) Terminal Naming (Tricky)

File: `packages/app/src/context/terminal.tsx`

Completed (2026-01-20):

- Terminal display labels are now rendered from a stable numeric `titleNumber` and localized via `terminal.title.*`.
- Added a one-time migration to backfill missing `titleNumber` by parsing the stored title string.

## Low Priority: Utils / Dev-Only Copy

### 17) Default Attachment Filename

File: `packages/app/src/utils/prompt.ts`

Completed (2026-01-20):

- Added `common.attachment` and plumbed it into `extractPromptFromParts(...)` as `opts.attachmentName`.

### 18) Dev-only Root Mount Error

File: `packages/app/src/entry.tsx`

Completed (2026-01-20):

- Localized the DEV-only root mount error via `error.dev.rootNotFound`.
- Selected locale using `navigator.languages` to match the app’s default detection.

## Prioritized Implementation Plan

No remaining work in `packages/app/` as of 2026-01-20.

## Suggested Key Naming Conventions

To keep the dictionaries navigable, prefer grouping by surface:

- `error.page.*`, `error.chain.*`
- `prompt.*` (including examples, tooltips, empty states, toasts)
- `provider.connect.*` (auth flow UI + validation + success)
- `session.share.*` (publish/unpublish/copy link)
- `context.usage.*` (Tokens/Usage/Cost + call to action)
- `lsp.*` (and potentially `mcp.*` if expanded)
- `notification.session.*`
- `toast.file.*`, `toast.session.*`

Also reuse existing command keys for tooltip titles whenever possible (e.g. `command.sidebar.toggle`, `command.review.toggle`, `command.terminal.toggle`).

## Appendix: Remaining Files At-a-Glance

Pages:

- (none)

Components:

- (none)

Context:

- (none)

Utils:

- (none)
