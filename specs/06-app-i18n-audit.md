# App i18n Audit (Remaining Work)

Scope: `packages/app/`

Date: 2026-01-20

This report documents the remaining user-facing strings in `packages/app/src` that are still hardcoded (not routed through `useLanguage().t(...)` / translation keys), plus i18n-adjacent issues like locale-sensitive formatting.

## Current State

- The app uses `useLanguage().t("...")` with dictionaries in `packages/app/src/i18n/en.ts` and `packages/app/src/i18n/zh.ts`.
- Recent progress (already translated): `packages/app/src/pages/home.tsx`, `packages/app/src/pages/layout.tsx`, `packages/app/src/pages/session.tsx`, `packages/app/src/components/prompt-input.tsx`, `packages/app/src/components/dialog-connect-provider.tsx`, `packages/app/src/components/session/session-header.tsx`, `packages/app/src/pages/error.tsx` (plus new keys added in both dictionaries).
- Dictionary parity check: `en.ts` and `zh.ts` currently contain the same key set (354 keys each; no missing or extra keys).

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

**Untranslated strings**
- "New session"
- "Main branch" / "Main branch ({branch})"
- "Create new worktree"
- "Last modified"

### 6) Context Usage Tooltip

File: `packages/app/src/components/session-context-usage.tsx`

**Untranslated tooltip labels**
- "Tokens", "Usage", "Cost"
- "Click to view context"

**Locale formatting issue**
- Uses `new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })`.
- Recommendation: format using the active locale (e.g. `language.locale()`), or at least `navigator.language`.

### 7) Session Context Tab (Formatting)

File: `packages/app/src/components/session/session-context-tab.tsx`

- Already uses many translation keys for labels (e.g. `context.breakdown.system`).
- Still forces `Intl.NumberFormat("en-US", ...)` for currency.
- Has some non-translated fallback symbols like "--" and "-" style output (e.g. "---" / "-" / "--" equivalent "--" is used as "—" in code).
  - If you want fully localized punctuation, these should become keys as well.

### 8) LSP Indicator

File: `packages/app/src/components/session-lsp-indicator.tsx`

**Untranslated strings**
- Tooltip: "No LSP servers"
- Label suffix: "{connected} LSP" (acronym likely fine; the framing text should be localized)

### 9) Session Tab Close Tooltip

File: `packages/app/src/components/session/session-sortable-tab.tsx`

**Untranslated strings**
- Tooltip: "Close tab"

Note: you already have `common.closeTab`.

### 10) Titlebar Tooltip

File: `packages/app/src/components/titlebar.tsx`

**Untranslated strings**
- "Toggle sidebar"

Note: can likely reuse `command.sidebar.toggle`.

### 11) Model Selection "Recent" Group

File: `packages/app/src/components/dialog-select-model.tsx`

**Untranslated / fragile string**
- Hardcoded category name comparisons against "Recent".

Recommendation: introduce a key (e.g. `model.group.recent`) and ensure both the grouping label and the comparator use the localized label, or replace the comparator with an internal enum.

### 12) Select Server Dialog Placeholder (Optional)

File: `packages/app/src/components/dialog-select-server.tsx`

- Placeholder: `http://localhost:4096`

This is an example URL; you may choose to keep it as-is even after translating surrounding labels.

## Medium Priority: Context Modules

### 13) OS/Desktop Notifications

File: `packages/app/src/context/notification.tsx`

**Untranslated notification titles / fallback copy**
- "Response ready"
- "Session error"
- Fallback description: "An error occurred"

Recommendation: `notification.session.*` namespace (separate from the permission/question notifications already added).

### 14) Global Sync (Bootstrap Errors + Toast)

File: `packages/app/src/context/global-sync.tsx`

**Untranslated toast title**
- `Failed to load sessions for ${project}`

**Untranslated fatal init error**
- `Could not connect to server. Is there a server running at \`${globalSDK.url}\`?`

### 15) File Load Failure Toast (Duplicate)

Files:
- `packages/app/src/context/file.tsx`
- `packages/app/src/context/local.tsx`

**Untranslated toast title**
- "Failed to load file"

Recommendation: create one shared key (e.g. `toast.file.loadFailed.title`) and reuse it in both contexts.

### 16) Terminal Naming (Tricky)

File: `packages/app/src/context/terminal.tsx`

- User-visible terminal titles are generated as "Terminal" and "Terminal N".
- There is parsing logic `^Terminal (\d+)$` to compute the next number.

Recommendation:
- Either keep these English intentionally (stable internal naming), OR
- Change the data model to store a stable numeric `titleNumber` and render the localized display label separately.

## Low Priority: Utils / Dev-Only Copy

### 17) Default Attachment Filename

File: `packages/app/src/utils/prompt.ts`

- Default filename fallback: "attachment"

Recommendation: `common.attachment` or `prompt.attachment.defaultFilename`.

### 18) Dev-only Root Mount Error

File: `packages/app/src/entry.tsx`

- Dev-only error string: "Root element not found..."

This is only thrown in DEV and is more of a developer diagnostic. Optional to translate.

## Prioritized Implementation Plan

1. `packages/app/src/components/session/session-new-view.tsx`
2. `packages/app/src/components/session-context-usage.tsx` + locale formatting improvements (also `packages/app/src/components/session/session-context-tab.tsx`)
3. Small stragglers:
   - `packages/app/src/components/session-lsp-indicator.tsx`
   - `packages/app/src/components/session/session-sortable-tab.tsx`
   - `packages/app/src/components/titlebar.tsx`
   - `packages/app/src/components/dialog-select-model.tsx`
   - `packages/app/src/context/notification.tsx`
   - `packages/app/src/context/global-sync.tsx`
   - `packages/app/src/context/file.tsx` + `packages/app/src/context/local.tsx`
   - `packages/app/src/utils/prompt.ts`
4. Decide on the terminal naming approach (`packages/app/src/context/terminal.tsx`).

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
- `packages/app/src/components/session/session-new-view.tsx`
- `packages/app/src/components/session-context-usage.tsx`
- `packages/app/src/components/session/session-context-tab.tsx` (formatting locale)
- `packages/app/src/components/session-lsp-indicator.tsx`
- `packages/app/src/components/session/session-sortable-tab.tsx`
- `packages/app/src/components/titlebar.tsx`
- `packages/app/src/components/dialog-select-model.tsx`
- `packages/app/src/components/dialog-select-server.tsx` (optional URL placeholder)

Context:
- `packages/app/src/context/notification.tsx`
- `packages/app/src/context/global-sync.tsx`
- `packages/app/src/context/file.tsx`
- `packages/app/src/context/local.tsx`
- `packages/app/src/context/terminal.tsx` (naming)

Utils:
- `packages/app/src/utils/prompt.ts`
- `packages/app/src/entry.tsx` (dev-only)
