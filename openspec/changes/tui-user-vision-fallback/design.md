## Context

The TUI model dialog (`packages/tui/src/component/dialog-model.tsx` and `dialog-model-twopane.tsx`) is a `DialogSelect` over the provider catalog. `local.tsx` already persists per-user state in `~/.kancode/state/model.json` (`recent` / `favorite` / `variant` / `hidden` / `notes`) via `modelStore` + `writeJsonAtomic`. The footer action bar is implemented in `dialog-select.tsx`'s `actions[]` prop; each entry is a `{ command, title, hidden?, disabled?, onTrigger? }` object. `DialogSelect` dispatches `onTrigger(option)` when the user activates the action with a key, a tab, or a click (`dialog-select.tsx:445-452`).

There is no current path for a text-only model to handle a user-attached image. `packages/kancode/src/provider/transform.ts:374-410` (`unsupportedParts`) replaces the image part with a `text` error: `ERROR: Cannot read "..." (this model does not support image input). Inform the user.` This change is the user-scope UX half of a future server-side wiring; it persists the desired fallback target without touching the runtime yet.

Per-model personalizations today are split: `favorite` / `hidden` / `note` are exposed as single-key footer actions in the model list (`variant` is reached automatically after model selection via `resolveVariantApply` in `dialog-model-flow.ts`). The user wants:

- `favorite` (binding `ctrl+f`, per `keybind.ts:121`) and `hide` (binding `h`, per `keybind.ts:122`) to stay as direct shortcuts in the model list action bar — these are the most common personalizations and deserve a one-keystroke flow.
- `note` removed from the model list; the `n` key is unbound from note editing. Notes are reachable only through the consolidated `c` entry.
- A single consolidated entry (binding `c`) for the remaining operations (`Set/Clear favorite`, `Set/Clear hidden`, `Note`, vision-fallback Set/Clear), mirroring the `dialog.replace(...)` / `dialog.push(...)` pattern already in use for `DialogNote`.

The variant picker flow stays as-is (post-select auto-entry). This change does not add or alter variant selection.

## Goals / Non-Goals

**Goals:**

- Add a `model.dialog.config` (binding `c`) entry to the model list that opens a `DialogConfig` submenu exposing `Set/Clear favorite`, `Set/Clear hidden`, `Note`, and `Set/Clear vision fallback`.
- Persist user-scope vision fallback in `state/model.json` with both a **global default** (`attachmentFallback`) and a **per-model override map** (`modelAttachmentFallback`). Both are active in v1; the per-model map is no longer reserved.
- Surface the fallback state in the model row's capability line as the token `fallback-vision` (no target name) when the model has no vision and a fallback is set.
- Keep `model.dialog.favorite` (binding `ctrl+f`, per `keybind.ts:121`) and `model.dialog.hide` (binding `h`, per `keybind.ts:122`) in the model list action bar; the `model.dialog.config` submenu also accepts them so users can flip state from inside the submenu.
- Remove the `model.dialog.note` (binding `n`) action from the model list and remove the keybind; the `Note` option in `DialogConfig` is the only way to edit a note in v1.
- Remove the `model.dialog.variant` (binding `v`) command and keybind entirely; variant selection is reached via the post-select flow.
- Backward-compatible `state/model.json` — additive keys with defensive loaders mirroring the existing `hidden` / `notes` pattern.
- Pure client-side TUI change. No `kancode.json` writes, no Protocol/Server/Client changes, no `bun run generate`.

**Non-Goals:**

- Server-side / runtime wiring of the fallback (this is a separate change that touches `Protocol` / `Server` / `message-v2.ts` / `transform.ts`).
- `kancode.json`-level fallback configuration (`attachment.image.fallback_model` and `provider.models.*.attachments.image.fallback_model`). Tracked in a follow-up change.
- Session-scope per-turn fallback override.
- Surfacing the fallback target's name in the model row (per the user requirement; visible only inside `DialogConfig`).
- Changing the variant post-select flow (`resolveVariantApply` in `dialog-model-flow.ts`).
- Cross-provider fallback warnings ("needs: OLLAMA_API_KEY"). The picker lists all providers uniformly in v1.
- A new layout primitive or new `DialogSelect` API. The change composes existing pieces.

## Decisions

### 1. `DialogConfig` is a `DialogSelect` submenu, not a new layout primitive

**Decision:** `DialogConfig` is a single `DialogSelect` (`packages/tui/src/ui/dialog-select.tsx`) over a flat option list. The per-model operations are `DialogSelectOption` entries; selecting one either calls the store directly (`toggleFavorite`, `toggleHidden`, `setAttachmentFallback`, `clearAttachmentFallback`) or `dialog.push(() => <DialogNote|DialogFallback model={model} />)`. (No `DialogVariant` entry — variant selection is reached via the post-select flow.) The submenu **does not close** after a direct call so the user can adjust multiple settings in one visit; `dialog.push`-based entries naturally return to the submenu when their inner dialog closes.

**Why a `DialogSelect` over a custom layout?** `DialogSelect` already handles keymap registration, tab cycle between actions, mouse handling, and `onTrigger` dispatch. Forks would duplicate the action bar. A flat list of operations inside a `DialogSelect` is two-dozen lines and matches the existing `DialogVariant` pattern.

**Why keep the submenu open after direct operations?** Toggle-style operations (`setFavorite` / `clearFavorite` / `setHidden` / `clearHidden`) need the user to see the new state of the option. Closing the submenu forces a re-entry just to verify. After selecting `Set favorite`, the option list re-renders to show `Clear favorite` instead, so the user sees the new state without a parenthetical.

**Alternative considered:** A modal per-operation (`Set favorite? [Y/n]`) — rejected, two screens of friction for a single toggle.

### 2. Set / Clear options for Favorite and Hide, per-model options for Vision fallback

**Decision:** Inside `DialogConfig`, the option list is:

```
Set favorite
Clear favorite        (only when currently favorited)
Set hidden
Clear hidden          (only when currently hidden)
Note: fast for refactors   (or "Add note" when empty)
Set fallback vision model (global: <target>)   (only when model is text-only
                                               AND no per-model entry is set;
                                               parenthetical describes the
                                               global target, or omitted when
                                               no global is set either)
Clear fallback vision model: <target>   (only when model is text-only AND a
                                        per-model override is set; target is
                                        the per-model override value, or
                                        "(none)" for an explicit opt-out)
No fallback needed (vision-capable)   (only when the model is vision-capable;
                                      informational row, Enter is a no-op)
```

The Set / Clear pair collapses to a single visible entry for Favorite / Hide (and the vision-fallback section follows the same pattern) when the user has nothing to do in one direction. **No parenthetical** is shown for favorite / hide — the action verb (`Set` / `Clear`) already conveys the current state. The `Note` option title is `Note: <truncated note>` when a note exists, or `Add note` when empty (no quote marks around the text). The `Set fallback vision model` picker does NOT show an in-picker clear row when invoked from `DialogConfig`; the user clears via the `Clear fallback vision model: <target>` row in the submenu. This keeps a single place to clear a per-model override (the submenu) and avoids the picker needing a `clearLabel` for the per-model flow; the `/vision-fallback` slash command flow still passes `clearLabel` + `onClear` so the user can clear the global from inside the picker. There is intentionally no separate `Use global fallback (...)` status row — the row's own label carries the current state, so a separate non-selectable row would be redundant noise.

The **global default** is configured separately via the `/vision-fallback` slash command (see Decision 9). It is NOT exposed inside `DialogConfig` — the model list is a per-model surface, and global actions belong in the prompt's slash-command layer alongside `/models`, `/rename`, `/compact`.

There is intentionally no `Variants` option in `DialogConfig` — variant selection is reached via the existing post-select flow (`resolveVariantApply` in `dialog-model-flow.ts`).

**Why explicit Set / Clear, not toggle?** A toggle entry hides the current state in a key. Per the user requirement, the user wants to see `Set favorite` (currently off) and explicitly choose to flip, not press a key and discover the result on next open. The Set / Clear pair achieves this without redundant parentheticals. The label is self-describing because `Set` and `Clear` are antonyms that map unambiguously to the current state. This is also less surprising: it matches IDE "Find Next" / "Find Previous" rather than a single "Find" that toggles direction.

### 3. `state/model.json` additive shape with global default and per-model overrides

**Decision:** Extend the existing `modelStore` and `writeJsonAtomic` payload:

```jsonc
{
  "recent":   [{ "providerID": "anthropic", "modelID": "claude-sonnet-4-5" }],
  "favorite": [{ "providerID": "anthropic", "modelID": "claude-sonnet-4-5" }],
  "variant":  { "anthropic/claude-sonnet-4-5": "thinking-high" },
  "hidden":   [{ "providerID": "openai", "modelID": "gpt-4-0314" }],
  "notes":    { "anthropic/claude-sonnet-4-5": "fast and cheap for refactors" },
  "attachmentFallback": { "providerID": "opencode", "modelID": "glm-4.6v" },
  "modelAttachmentFallback": {
    "zhipu/glm-5.2": { "providerID": "opencode", "modelID": "kimi-k2-vision" }
  }
}
```

`attachmentFallback` is the **global default** consulted when no per-model override is set. `modelAttachmentFallback` is a `Record<string, { providerID, modelID } | null>` keyed by `providerID/modelID`. An entry value of:

- A target object `{ providerID, modelID }` — this model uses this fallback, shadowing the global.
- `null` — this model has **no** fallback at all, even if the global is set. (Explicit "opt out".)
- Missing key — fall back to the global.

The accessor `local.model.fallbackFor(model)` implements this resolution order:
1. Look up `modelAttachmentFallback[modelKey]`. If the key is present, return its value (object or `null`).
2. Otherwise return `attachmentFallback()`.

Both fields are read and written by `save()`. The defensive loader validates that `modelAttachmentFallback` is a non-null object and ignores malformed types. Missing keys default to `null` / `{}`.

**Why per-model as a map of `null | target` rather than just `target`?** Users must be able to explicitly opt a single model OUT of the global fallback (e.g. a model they never use for image tasks, where they want the runtime to fail loudly instead of silently switching). Without `null` as a value, opting out is impossible — the only way to disable a fallback for a model is to clear the global, which affects every other model. Treating `null` as a first-class value is a tiny cost for a real escape hatch.

**Why not store as `attachmentFallback: "opencode/glm-4.6v"` (string) instead of an object?** A structured value keeps the type consistent with `recent` / `favorite` / `hidden` entries and avoids a parsing step on read. The cost is two extra fields per object; the JSON size impact is negligible.

### 4. `DialogFallback` is a stateless picker; `DialogConfig` and the slash command route the result

**Decision:** `DialogFallback` follows `packages/tui/src/component/dialog-variant.tsx:19-106` structurally. It accepts four props: an optional `commit: (target: { providerID, modelID } | null) => void` callback, an optional `current` target (displayed as the `Currently:` label header), an optional `clearLabel: string`, and an optional `onClear: () => void`. When the user picks a vision model, `DialogFallback` calls `commit({ providerID, modelID })` and `dialog.pop()` to return to the caller. When the user picks the clear row, `DialogFallback` calls `onClear()` and `dialog.pop()`. The picker itself does **not** know whether it is setting the global, setting a per-model override, or clearing — the caller chooses via `commit` and `onClear`. The picker uses `dialog.pop()` (not `dialog.clear()`) so that the caller layer (e.g. `DialogConfig` or the prompt) is preserved on return; closing the dialog stack entirely would be a regression from the caller's perspective.

The options list is built in three parts (in order):

1. **A `Currently: <providerID>/<modelID>` header entry** (only when a `current` prop is passed) — informational label row showing the current effective target. `DialogConfig` computes this via `local.model.fallbackFor(props.model)` and passes it in; the slash command passes `local.model.attachmentFallback()`. The row has no `onSelect`, so pressing Enter is a no-op. The row is rendered WITHOUT `disabled: true` (same reason as the `No fallback needed` row in `DialogConfig`: `DialogSelect` filters `disabled: true` out unconditionally).
2. **A `Clear ...` row** (only when both `clearLabel` and `onClear` are supplied by the caller) — selecting it invokes `onClear()`. The slash command supplies `clearLabel="Clear global vision fallback"` + `onClear={local.model.clearAttachmentFallback}` only when the global is set (so the picker is not a confusing "nothing to clear" experience). `DialogConfig` does NOT supply `clearLabel` / `onClear`; the per-model flow has its own `Clear fallback vision model: <target>` row in the submenu (see Decision 4), and adding a second clear path inside the picker would be redundant.
3. **The vision-capable model list**, filtered from `sync.data.provider` for `capabilities.input.image === true || capabilities.attachment === true || capabilities.input.pdf === true` (matching the broader vision condition from `util/model.ts:58`).

Esc returns to the caller without saving (`dialog.pop()` from the picker level; the caller's layer is preserved). `DialogFallback` does not use `DialogSelect`'s `current` prop because the fallback target is a `{ providerID, modelID }` object, not a string; the `Currently:` label entry achieves the same UX.

**`DialogConfig` decides the routing.** When the user picks `Set fallback vision model`, `DialogConfig` pushes `DialogFallback` with `commit={(target) => local.model.setModelAttachmentFallback(model, target)}`. When the slash command runs `/vision-fallback`, it pushes `DialogFallback` with `commit={(target) => local.model.setAttachmentFallback(target)}` and an `onClear` when the global is set. The picker is identical; only the props differ.

**Why a separate `DialogFallback` component, not inline in `DialogConfig`?** A `DialogSelect` over ~300+ models across providers needs the same search / provider-grouping / favorite-aware row treatment the model list itself uses. Inlining would either duplicate `modelRow` (`packages/tui/src/util/model-row.tsx`) or fork `DialogModel`. A dedicated ~80-line component is the same shape as the existing `DialogVariant`.

**Why a global filter on `input.image` (and `input.pdf` and `attachment`), not "models with vision AND on the same provider"?** A user-scope fallback is intentionally cross-provider. The picker should let the user pick any vision-capable model they have credentials for, not just same-provider options. Cross-provider key validation is out of scope (see proposal non-goals). The picker includes models with PDF-only vision because they are viable fallback targets for text+image prompts that get OCR'd at the receiving end.

**`DialogConfig` vision-fallback option layout** (one of these variants, depending on the model's effective state):

| State | Visible options |
|---|---|
| Vision-capable model | `No fallback needed (vision-capable)` (informational; no `disabled: true` so it is not filtered out by `DialogSelect`) |
| Text-only, no global, no per-model | `Set fallback vision model` |
| Text-only, global set, no per-model for this model | `Set fallback vision model (global: opencode/glm-4.6v)` |
| Text-only, per-model override set, different from global | `Clear fallback vision model: opencode/kimi-k2-vision` |
| Text-only, per-model override `null` (explicit opt-out) | `Clear fallback vision model: (none)` |
| Text-only, both global and per-model set to same target | `Clear fallback vision model: opencode/glm-4.6v` |

There is intentionally no `Use global fallback (...)` status row — the row's own label carries the current state. The vision-fallback section shows exactly one row at any time, drawn from a three-way branch on `(visionCapable, hasPerModelEntry)`: vision-capable → informational row; text-only with per-model entry → `Clear`; text-only without per-model entry → `Set`. To change the per-model value when one is set, the user clicks Clear (removes the per-model entry, falls back to the global or `undefined`), then Set + pick a new model. This is the same two-step pattern as Clear favorite → Set favorite. The per-model picker does NOT show a clear row (it would duplicate this row in the same submenu). The `/vision-fallback` slash command flow does pass a `clearLabel` so the user can clear the global from inside the picker.

### 5. `capabilityLine` gains an optional `fallback` parameter, renders `fallback-vision` with per-source color

**Decision:** `capabilityLine(model, fallback?: { providerID, modelID } | null)` in `packages/tui/src/util/model.ts:53-79` is extended. The `fallback-vision` token is inserted **between** the status badges (`ALPHA` / `BETA`) and the `+N variants` token, so a long variants list does not push the `fallback-vision` chip off the right edge of the row:

```ts
// Order: reasoning, tools, vision, audio-in, audio-out, image-out,
// ALPHA/BETA, then fallback-vision (when applicable), then +N variants.
if (caps?.reasoning) parts.push("reasoning")
if (caps?.toolcall) parts.push("tools")
if (caps?.attachment || caps?.input?.image || caps?.input?.pdf) parts.push("vision")
if (caps?.input?.audio) parts.push("audio-in")
if (caps?.output?.audio) parts.push("audio-out")
if (caps?.output?.image) parts.push("image-out")
if (model.status === "alpha") parts.push("ALPHA")
if (model.status === "beta") parts.push("BETA")
if (fallback && !caps?.attachment && !caps?.input?.image && !caps?.input?.pdf) {
  parts.push("fallback-vision")
}
if (model.variants) {
  const n = Object.keys(model.variants).length
  if (n > 0) parts.push(`+${n} variant${n === 1 ? "" : "s"}`)
}
return parts.join(" · ")
```

This clause mirrors the existing `vision` token condition (line 58 of `util/model.ts`): `caps?.attachment || caps?.input?.image || caps?.input?.pdf`. The negated form means `fallback-vision` is shown only when the model has none of the three vision capabilities. Without the `input?.pdf` clause, a PDF-only model (e.g. `claude-3.5-sonnet` with `input.pdf: true` but no `input.image`) would be incorrectly tagged `fallback-vision` even though it can already process vision input via PDF.

**Single-row rendering of the capability line with per-token color for `fallback-vision`.** The capability line is built as `CapabilitySegment[]` via `capabilityLineSegments(...)` and passed to `modelRow` as `capabilitySegments`. `modelRow` puts a single `{ parts: [...] }` entry into `option.details` (one detail row). Renderers in `dialog-select.tsx` and `dialog-model-twopane.tsx` `RowContent` draw each part inline with `·` separators: `fallback-vision` uses `theme.info` when the fallback is a per-model override, and `theme.textMuted` when it is the inherited global. Other tokens stay muted. This uses plain data objects (not JSX elements) in `details`, avoiding the Solid render crash from the earlier JSX-in-details experiment (task 10). When the joined line exceeds the width budget, the renderer falls back to a single muted truncated string.

All callers of `modelRow` / `buildModelRow` (in `model-row.tsx:130` for the pure helper, and the call site in `dialog-model-twopane.tsx`) thread the pre-computed `capabilityLineText` (or, for callers that do not need per-row fallback, omit it and let `modelRow` fall back to `capabilityLine(model, fallback)`). `modelRow` is a pure function (not a component) and cannot call `useLocal`, so the resolved capability line must be threaded in by the caller.

**Why not show the target name (e.g. `fallback-vision → opencode/glm-4.6v`)?** Per the user requirement, the model row is space-constrained (cost + context tokens on the right, title truncated left). A target name is 20+ characters and would force the title to truncate aggressively. The `c` action is one keystroke away, and the current value is in the action's parenthetical anyway.

**Why `fallback-vision` and not `↪ vision` or `vision (fallback)`?** Consistency with the existing capability line vocabulary: `reasoning`, `tools`, `vision`, `audio-in`, `audio-out`, `image-out`, `ALPHA`, `BETA`, `+N variants` — all lowercase ASCII tokens. `fallback-vision` reads as a capability line "this model falls back to vision" without conflating with the `vision` token (which means the model itself can see images).

### 6. Action bar keeps favorite/hide shortcuts, removes note and variant, adds config

**Decision:** Both `dialog-model.tsx` and `dialog-model-twopane.tsx` `actions[]` arrays are trimmed to four entries:

```ts
[
  {
    command: "model.dialog.provider",
    title: connected() ? "Connect provider" : "View all providers",
    onTrigger() { dialog.replace(() => <DialogProvider />) },
  },
  {
    command: "model.dialog.favorite",
    title: (option) => {
      const value = option?.value as { providerID: string; modelID: string }
      if (!value) return "Favorite"
      // No `isFavorite` accessor exists on `local.model`; use `favorite().some(...)` to match
      // the existing pattern at `dialog-model-twopane.tsx:251-256`.
      const favorited = local.model.favorite().some(
        (f) => f.providerID === value.providerID && f.modelID === value.modelID,
      )
      return favorited ? "Unfavorite" : "Favorite"
    },
    hidden: !connected(),
    onTrigger(option) { local.model.toggleFavorite(option.value as ModelValue) },
  },
  {
    command: "model.dialog.hide",
    title: (option) => {
      const value = option?.value as { providerID: string; modelID: string }
      return value && local.model.isHidden(value) ? "Unhide" : "Hide"
    },
    hidden: !connected(),
    singleKey: true,
    onTrigger(option) { local.model.toggleHidden(option.value as ModelValue) },
  },
  {
    command: "model.dialog.config",
    title: "Edit model",
    hidden: !connected(),
    singleKey: true,
    onTrigger(option) {
      dialog.push(() => <DialogConfig model={option.value as ModelValue} />)
    },
  },
]
```

`model.dialog.favorite` (binding `ctrl+f`) and `model.dialog.hide` (binding `h`) stay in the model list as direct one-keystroke shortcuts — these are the most common personalizations and the user wants them to remain reachable without an extra menu hop. `model.dialog.note` (binding `n`) is removed from the model list and from the keymap; the `Note` option inside `DialogConfig` is the only path. `model.dialog.variant` (binding `v`) is also removed; variant selection is reached via the post-select flow.

`model.dialog.favorite` and `model.dialog.hide` command IDs remain registered in the keymap, so they also resolve from inside `DialogConfig` (the user can press `f` to flip favorite state directly while the submenu is open). `model.dialog.note` and `model.dialog.variant` command IDs are removed entirely.

**Why keep `f` / `h` as direct shortcuts but remove `n` / `v`?** The user has explicit muscle-memory expectations for favorite and hide (toggled frequently, low cost to expose). Notes are edited rarely; routing through `DialogConfig` is acceptable. Variants are reached automatically after model selection, so a separate manual action is redundant.

**Why remove `model.dialog.note` and `model.dialog.variant` command IDs rather than preserve them for in-submenu triggers?** `model.dialog.note` has no remaining trigger surface — there is no longer any UI that would dispatch it. `model.dialog.variant` is similarly unused because the post-select flow handles variant picking without a command. Preserving the command IDs adds dead code; removing them keeps the keymap honest.

**Why not rebind `n` and `v` to "open DialogConfig" when in the model dialog?** That would make `n`, `v`, and `c` all open the same dialog — a confusing overlap. Keeping the keys unbound outside the submenu matches the user's mental model: `c` is the only "open submenu" key, and `f` / `h` are the only "act on the highlighted model" keys.

### 7. Keymap registration

**Decision:** Modify `packages/tui/src/config/keybind.ts`:

```ts
// line ~120 (keybind def): add
model_config: keybind("c", "Edit model config"),

// line ~121-124: keep
model_favorite_toggle: keybind("ctrl+f", "Toggle model favorite status"), // existing label — keep
model_hide_toggle: keybind("h", "Toggle model hidden status"),          // existing
// model_note_edit: REMOVED
// model_variant_list: REMOVED

// line ~328-331 (command mapping): add
model_config: "model.dialog.config",
// keep model_favorite_toggle: "model.dialog.favorite"
// keep model_hide_toggle: "model.dialog.hide"
// remove model_note_edit
// remove model_variant_list
```

Net effect: add `c` for `model.dialog.config`; remove `n` (model_note_edit → model.dialog.note) and `v` (model_variant_list → model.dialog.variant) from both the keybind def block and the command mapping block.

**Why `c`?** "c" is mnemonic for "config" and is unused in the model dialog's `DialogSelect` keymap (`prev` / `next` / `page_up` / `page_down` / `home` / `end` / `submit` / tab / shift-tab / esc / enter). It does not collide with any other footer action.

### 9. Global fallback is a session-level slash command, not a model action

**Decision:** The global default is configured via a new `vision-fallback` entry in `sessionCommandList` (`packages/tui/src/routes/session/index.tsx:463-1032`). The entry follows the same shape as `session.rename` / `session.compact` / `session.fork`:

```ts
{
  title: "Set vision fallback",
  value: "session.vision_fallback",
  category: "Session",
  slash: { name: "vision-fallback", aliases: ["vf"] },
  run: () => {
    const current = local.model.attachmentFallback()
    dialog.push(() => (
      <DialogFallback
        title="Set global vision fallback"
        current={current ?? null}
        // Show the clear row only when a global is set; the picker
        // without a "clear" action is a confusing experience.
        clearLabel={current ? "Clear global vision fallback" : undefined}
        onClear={current ? () => local.model.clearAttachmentFallback() : undefined}
        commit={(target) => {
          if (target) local.model.setAttachmentFallback(target)
        }}
      />
    ))
  },
},
```

This puts the global alongside `/models` (`model_list` keybind `<leader>m`), `/rename`, `/timeline`, `/fork`, `/compact`, `/undo` — all global per-session actions. The command:

- Is **not** in the model list's footer action bar. That bar is reserved for per-model actions (favorite / hide / config).
- Is **not** in `DialogConfig` (the per-model submenu). The per-model submenu handles `Set fallback vision model` / `Clear fallback vision model: <target>`; the global lives at the session level.
- Auto-registers as the `/vision-fallback` (and `/vf`) slash command in the prompt input's autocomplete (via `useCommandSlashes()` and the `useBindings` plumbing at `routes/session/index.tsx:1045-1047`), and appears in the command palette.

**Why a slash command and not a model-list action?** The user explicitly asked for this. A global setting has no "highlighted model" to attach to; it is a session-wide policy that travels with the user across models. Mirroring `/models` / `/rename` / `/themes` (all session-wide actions) gives the user a familiar mental model: type `/` to discover global actions, press `c` on a model row to discover per-model actions. The two surfaces do not overlap.

**Why alias `vf`?** Short, mnemonic (vision fallback → vf), matches the `compact`/`summarize` aliasing pattern (two commands, same target).

### 8. Migration / backward compatibility

**Decision:** The state-shape change is purely additive. `state/model.json` files written by older KanCode versions continue to load (defensive guards: `if (value.attachmentFallback && typeof value.attachmentFallback === "object") setModelStore(...)` and `if (value.modelAttachmentFallback && typeof value.modelAttachmentFallback === "object") setModelStore(...)`). Missing keys default to `null` / `{}`.

The action-bar change is a UX regression only for users who had muscle memory for `n` (note) and `v` (variant) in the model list:
- `n` → reachable via `c` → `Note` in `DialogConfig`. The `model.dialog.note` command ID and its `model_note_edit` keybind are removed; user keybinds that bind a key to `model.dialog.note` will fail validation. The release notes should call this out and suggest rebinding to a different action or removing the override.
- `v` → still works via the post-select flow. The `model.dialog.variant` command ID and its `model_variant_list` keybind are removed; user keybinds that bind a key to `model.dialog.variant` will fail validation.
- `f` (favorite) and `h` (hide) are unchanged from the user's perspective.

**Rollback:** delete the two new files (`dialog-config.tsx`, `dialog-fallback.tsx`), revert `local.tsx` / `dialog-model.tsx` / `dialog-model-twopane.tsx` / `util/model.ts` / `config/keybind.ts`. Old `model.json` files with `attachmentFallback` / `modelAttachmentFallback` keys load fine on previous code (extra keys ignored). Restored code that retains `model_note_edit` / `model_variant_list` keybinds works again.

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| Removing `n` and `v` from the model list breaks user keybinds and muscle memory | The commands `model.dialog.note` and `model.dialog.variant` are removed; any user `kancode.json` keybind that references them will fail validation. The release notes call this out and suggest removing or rebinding the affected overrides. `n` and `v` become no-ops in the model list. |
| `f` and `h` remain in the action bar; new users may still need to learn two shortcuts plus `c` for the rest | Documented in the change notes. The action bar shows the keys; the help dialog surfaces the keymap. |
| `DialogConfig` stays open after a direct toggle, which can feel sticky if the user only wanted to flip one setting | Esc returns to the model list; after `Set favorite` (or similar), the option list re-renders to show `Clear favorite` instead, so the user can verify the new state without re-entry. |
| `attachmentFallback` is read by the TUI but the runtime never honors it in v1 (server-side wiring is a follow-up) | Document in the proposal and in the slash command's dialog title (`Set global vision fallback`). The persisted value is harmless and travels with the user for when the server-side change ships. The `/vision-fallback` command is the only way to inspect the global from the TUI; the row capability line (`fallback-vision`) confirms the value is loaded. |
| Per-model override map (`modelAttachmentFallback`) is empty by default; users opt in per model | Discovery: `DialogConfig` shows the current effective state (global / per-model / opt-out) so the user sees the option to override or clear. The release notes and `tips-view.tsx` mention the feature. |
| `DialogFallback` lists ~300+ models across providers; picker may be slow | The picker reuses the same `DialogSelect` infrastructure as the model list, which is already expected to handle 300+ models (e.g., OpenRouter). The provider-grouped render is unchanged. |
| `DialogConfig` must mirror the current state of every setting each time it opens (favorites may have changed via a different dialog) | State is read from `modelStore` reactively via `createMemo` / `getters`; the submenu re-renders on store changes via Solid's fine-grained reactivity. No polling. |
| `capabilityLine` change adds a token to existing rows, potentially shifting the visible width budget | The token is appended only for non-vision models (a minority of catalog rows). The `modelRow` `titleWidth` budget already accounts for variable footer widths; one extra ~16-char token fits within the typical budget. No width regression expected. |
| `c` collides with a future global keybind | Keybinds in `DialogSelect` are scoped to the dialog's `useBindings` block, not global. `c` is currently free. We re-verify against `tuiConfig.keybinds.gather("dialog.select", [...])` in the keymap registry. |

## Open Questions

1. ~~Should the per-model `modelAttachmentFallback` map also be writable from the TUI in v1, or strictly global with a reservation?~~ **Resolved**: v1 ships per-model overrides via the TUI (per the user's request). The kancode.json-level fallback configuration (`attachment.image.fallback_model` and `provider.models.*.attachments.image.fallback_model`) is a separate change with a different merge-priority story (user scope vs project scope) and ships in a follow-up.
2. Should `DialogConfig` show the remaining operations in a fixed order (Favorite, Hidden, Note, Vision fallback) or sort by recent activity? Proposed: fixed order in v1, matches IDE settings panels.
3. Should `DialogFallback` exclude hidden models and models the user has favorited-as-text-only? Proposed: include all vision-capable models regardless of hidden/favorite state in v1, because the fallback is a separate concept from "models I see in the list".
4. When the active model has a user-scope fallback set and the user hides the fallback target, should the fallback silently clear, or should it stay and surface a warning on next use? Proposed: stay (the hidden gate will be honored when the runtime wiring ships); the picker does not auto-clear.
