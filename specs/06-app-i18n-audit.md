# App i18n Audit (Remaining Work)

Scope: `packages/app/`

Date: 2026-01-20

This report documents the remaining user-facing strings in `packages/app/src` that are still hardcoded (not routed through `useLanguage().t(...)` / translation keys), plus i18n-adjacent issues like locale-sensitive formatting.

## Current State

- The app uses `useLanguage().t("...")` with dictionaries in `packages/app/src/i18n/en.ts` and `packages/app/src/i18n/zh.ts`.
- Recent progress (already translated): `packages/app/src/pages/home.tsx`, `packages/app/src/pages/layout.tsx`, `packages/app/src/pages/session.tsx`, `packages/app/src/components/prompt-input.tsx` (plus new keys added in both dictionaries).
- Dictionary parity check: `en.ts` and `zh.ts` currently contain the same key set (285 keys each; no missing or extra keys).

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

This is the largest remaining untranslated surface and is user-visible during app failures.

**Page UI copy** (headings/buttons/labels):
- "Something went wrong"
- "An error occurred while loading the application."
- Text field label: "Error Details"
- Buttons: "Restart", "Checking...", "Check for updates", "Update to {version}"
- Reporting help: "Please report this error..." and the link caption "on Discord"
- Version display prefix: "Version: {platform.version}"

**Error chain / formatting strings** (shown inside the details field):
- "Unknown error"
- "Caused by:"
- "Status:", "Retryable:", "Response body:"
- Generic API fallback: "API error"
- Suggestion prefix: "Did you mean: ..."

**Recommendation:**
- Translate all framing/UI labels and action buttons.
- Decide whether to translate highly technical diagnostics. A good compromise is:
  - Translate the labels ("Caused by", "Unknown error", "Status")
  - Keep raw messages from servers/providers as-is

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

This flow is copy-heavy and user-facing.

**Representative untranslated strings**
- Login method label: "API key"
- Status text: "Authorization in progress...", "Waiting for authorization..."
- Validation: "API key is required", "Authorization code is required", "Invalid authorization code"
- Field labels/placeholders: "Confirmation code", placeholder "API key", placeholder "Authorization code"
- Instructional text:
  - "Visit this link ..."
  - Provider-specific guidance and OpenCode Zen onboarding paragraphs
- Buttons: "Submit"
- Success toast:
  - "{provider} connected"
  - "{provider} models are now available to use."

**Recommendation:**
- Add a `provider.connect.*` namespace.
- Consider adding shared common keys like `common.submit` if it is used elsewhere.

### 4) Session Header (Share/Publish UI)

File: `packages/app/src/components/session/session-header.tsx`

**Representative untranslated strings**
- Search placeholder: "Search {projectName}"
- Tooltips: "Toggle review", "Toggle terminal", "Share session"
- Share/publish popover:
  - "Publish on web"
  - "This session is public on the web..."
  - "Share session publicly on the web..."
  - Button states: "Publishing..." / "Publish", "Unpublishing..." / "Unpublish"
  - Buttons: "Share", "View"
- Copy tooltip: "Copied" / "Copy link"

**Recommendation:**
- Most of these should become `session.share.*` keys.
- Reuse command keys where appropriate (e.g. `command.review.toggle`, `command.terminal.toggle`) instead of introducing new duplicates.

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

1. `packages/app/src/components/dialog-connect-provider.tsx`
2. `packages/app/src/components/session/session-header.tsx`
3. `packages/app/src/pages/error.tsx`
4. `packages/app/src/components/session/session-new-view.tsx`
5. `packages/app/src/components/session-context-usage.tsx` + locale formatting improvements (also `packages/app/src/components/session/session-context-tab.tsx`)
6. Small stragglers:
   - `packages/app/src/components/session-lsp-indicator.tsx`
   - `packages/app/src/components/session/session-sortable-tab.tsx`
   - `packages/app/src/components/titlebar.tsx`
   - `packages/app/src/components/dialog-select-model.tsx`
   - `packages/app/src/context/notification.tsx`
   - `packages/app/src/context/global-sync.tsx`
   - `packages/app/src/context/file.tsx` + `packages/app/src/context/local.tsx`
   - `packages/app/src/utils/prompt.ts`
7. Decide on the terminal naming approach (`packages/app/src/context/terminal.tsx`).

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
- `packages/app/src/pages/error.tsx`

Components:
- `packages/app/src/components/dialog-connect-provider.tsx`
- `packages/app/src/components/session/session-header.tsx`
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
