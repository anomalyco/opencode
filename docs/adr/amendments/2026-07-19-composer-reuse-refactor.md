# Amendment 2026-07-19 — Composer Reuse Refactor (Stage 5)

## Context

The Todo Sidebar Feature workspace rule states:

> "The New Todo dialog must reuse the existing composer instead of reimplementing it."

Prior to this amendment, `packages/app/src/components/dialog-edit-todo.tsx`
shipped a bespoke autocomplete UI for the description field:

- A custom `<textarea>` element.
- Two parallel `<Show>` blocks rendering dropdown lists for `@file` and
  `/skill` references.
- A local `SlashCommand` interface overlapping the chat composer's exported
  `SlashCommand` type.
- Index-based active-item tracking (`atActive: 0`, `slashActive: 0`).

This was a reimplementation of UI that already exists in
`packages/app/src/components/prompt-input/slash-popover.tsx` as the
`PromptPopover` presentational component, which the chat composer
(`packages/app/src/components/prompt-input.tsx`) renders for the same
purpose.

## Decision

Replace the dialog's bespoke autocomplete dropdown with the shared
`PromptPopover` component. The dialog continues to own its own trigger
detection and insertion logic (those are tightly coupled to the
`<textarea>` and the dialog's `store.description` string state — they
cannot be reused as-is from the session-coupled composer), but the
**dropdown rendering, types, and i18n keys** are now shared.

### Scope of reuse

| Layer | Before | After |
| --- | --- | --- |
| Dropdown UI | Two custom `<Show>` blocks with custom buttons, classes, and i18n keys (`dialog.todo.autocomplete.noFiles`, `dialog.todo.autocomplete.noSkills`) | Single `<PromptPopover>` invocation |
| `@file` option type | `string` (raw path) | `AtOption` (`{ type: "file", path, display }`) |
| `/skill` option type | Local `interface SlashCommand` (subset of fields) | Imported `SlashCommand` from `slash-popover.tsx` (adds `type: "builtin" \| "custom"` discriminator) |
| Active-item tracking | Index-based (`number`) | Key/id-based (`string`), matching `PromptPopover`'s `atKey` / `cmd.id` contract |
| Keyboard navigation | `setUi("atActive", (i) => (i + 1) % items.length)` | Index derived from key via `items.findIndex((it) => atKey(it) === ui.atActive)`; key set back via `atKey(items[nextIdx])` |
| i18n keys | `dialog.todo.autocomplete.*` | `prompt.popover.emptyResults`, `prompt.popover.emptyCommands`, `prompt.slash.badge.*` (existing composer keys) |
| Keybind display | Not shown | `command.keybind(id)` / `command.keybindParts(id)` wired through `useCommand()` |

### What is NOT reused

The full `PromptInput` component
(`packages/app/src/components/prompt-input.tsx`) is **not** reused because
it is heavily session-coupled — it depends on `usePrompt`, `useLayout`,
`useSDK`, `useSync`, `useComments`, `useDialog`, `useCommand`,
`usePermission`, and `usePlatform`. Reusing it in a Todo dialog would
require mocking ~10 contexts, which is impractical and would couple the
dialog to session lifecycle it does not need.

The reusable surface is the **presentational** `PromptPopover` plus the
shared `AtOption` / `SlashCommand` types — exactly the parts that were
being reimplemented.

### Positioning trade-off

`PromptPopover` is styled with `absolute inset-x-0 -top-2 -translate-y-full`,
which positions the dropdown **above** its anchor (correct for the chat
composer where the input is docked to the bottom of the screen). In the
Todo dialog the description textarea is the second field in a scrollable
form body, so the popover renders above the textarea and overlaps the
Title input. This is a known trade-off of reusing the shared component
unchanged (per workspace rule: "Do not modify UI components that
originate from the main branch"). If clipping becomes a real UX problem,
a follow-up amendment can introduce a `placement` prop on
`PromptPopover` — but that is out of scope for this refactor.

## Changes

### `packages/app/src/components/dialog-edit-todo.tsx`

- **Imports**: Added `useCommand` from `@/context/command`; added
  `PromptPopover`, `type AtOption`, `type SlashCommand` from
  `@/components/prompt-input/slash-popover`.
- **Removed**: Local `interface SlashCommand` (now imported).
- **State**: `atResults: string[]` → `atOptions: AtOption[]`;
  `atActive: number` → `atActive: string` (key);
  `slashActive: number` → `slashActive: string` (id).
- **Added**: `atKey(x: AtOption | undefined): string` helper, mirroring
  the chat composer's key function.
- **`runAtQuery`**: Now maps paths to `AtOption[]` (`{ type: "file",
  path, display: path }`) and pre-selects the first item's key.
- **`insertAtSelection`**: Signature changed from `(path: string)` to
  `(option: AtOption | undefined)`; reads `option.path` for the `file`
  variant, falls back to `option.display` for other variants.
- **`insertSlashSelection`**: Signature widened to accept
  `SlashCommand | undefined` (PromptPopover's `onSlashSelect` may pass
  `undefined`); insertion logic unchanged.
- **`loadSlashCommands`**: Each entry now includes
  `type: "custom" as const` (required by the imported `SlashCommand`).
- **`handleDescriptionKeyDown`**: Switched from index arithmetic to
  key/id-based navigation (find index by key, compute next index, set
  key/id back).
- **JSX**: Replaced the two `<Show>` dropdown blocks (~75 lines) with a
  single `<PromptPopover>` invocation passing through `useCommand`'s
  `keybind` / `keybindParts` for keybind display.

### Orphaned i18n keys (intentionally left in place)

- `dialog.todo.autocomplete.noFiles`
- `dialog.todo.autocomplete.noSkills`

These were only used by the removed custom dropdowns. They are left in
the locale files because there is no rule requiring removal of orphaned
keys, and removing them across all locales is a separate cleanup. A
follow-up sweep can drop them if desired.

## Verification

- `bun --cwd packages/app typecheck` — passes.
- `bun --cwd packages/opencode typecheck` — passes.
- `bun --cwd packages/opencode test test/issue` — 21 pass, 1 known-LLM-flaky
  failure (`agent cannot delete an active issue`) which passes on re-run
  (confirmed: 1 pass, 0 fail in 8.10s when run in isolation). The
  failure is unrelated to this refactor — `issue_delete`'s
  `IssueNotArchivedError` guard is still in place; the LLM occasionally
  calls `issue_archive` first despite the "do not use any other tools"
  instruction.

## Relationship to prior amendments

- **2026-07-19-archived-issue-management-realignment.md** (Stage 1):
  removed `IssueArchivedError` from `Issue.update` / `Issue.reorder`
  and deleted `Issue.patchStatus`. This stage is UI-only and does not
  touch the kernel.
- **2026-07-19-catch-rule-source-alignment.md** (Stage 2): documented
  the `.catch()` vs `catchTag` rule sourcing. No interaction with this
  stage.

## Open questions

None. The refactor is complete and the workspace rule is satisfied:
the dialog no longer reimplements the composer's autocomplete UI — it
renders the same `PromptPopover` component the chat composer uses.
