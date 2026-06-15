# Drill-Down Menu — Attempt 1 Post-Mortem

## What Was Tried

A "drill-down" detail view for the slash skills menu in the opencode CLI TUI (`packages/opencode/src/cli/cmd/run/footer.command.tsx`).

When the user navigated to a skill row and pressed a key, the list would be replaced by a detail panel showing the skill's name, description, and template content. Pressing another key would return to the list.

---

## Implementation Approach

### State

```ts
const [drilledDown, setDrilledDown] = createSignal(false)

const drilledItem = createMemo(() => {
  if (!drilledDown()) return undefined
  return items()[menu.selected()]
})
```

### Render

Used a `<Show when={drilledItem()}>` to swap the `<RunFooterMenu>` list for a detail `<box>`:

```tsx
<Show when={drilledItem()} fallback={<RunFooterMenu ... onItemDrill={...} />}>
  {(item) => (
    <box ...>
      <text>{item().name}</text>
      <text>{item().description || "No content available"}</text>
      <text>ctrl+o / esc back</text>
    </box>
  )}
</Show>
```

### Trigger Keys Tried (three iterations, all failed)

| Iteration | Key | Problem |
|-----------|-----|---------|
| 1 | Right arrow (`→`) | Arrow keys handled by `handleKey` for menu navigation; event swallowed before reaching drill-down branch |
| 2 | Tab | Tab already used for panel switching in the outer footer; event never reached `RunSkillSelectBody` handler |
| 3 | Ctrl+E | Ctrl+E bound elsewhere in the opencode TUI; intercepted upstream |
| 4 | Ctrl+O via `useBindings` | `useBindings` hook fired, but state update didn't cause re-render; suspected stale container / hot-reload mismatch |

### Mouse Button (`>`)

Added an `onItemDrill` prop to `RunFooterMenu` that rendered a `" > "` text element per row with `onMouseDown`. Mouse events in the opentui terminal renderer are unreliable: `onMouseDown` on a `<text>` node does not consistently fire in container environments. This approach also didn't work.

---

## Root Cause Analysis

### Why keyboard shortcuts failed

The opencode CLI TUI uses a layered keyboard event system:

1. `@opentui/core` emits raw key events via `InternalKeyHandler`.
2. The `useKeyboard` hook in `@opentui/solid` registers a listener on the renderer's `keyInput` event.
3. Events propagate globally — **every `useKeyboard` handler in the entire component tree fires for every keypress** unless `event.preventDefault()` is called first.
4. `handleKey` (shared across all panels) calls `event.preventDefault()` on arrow keys, escape, and ctrl+c before any panel-specific code can run.
5. Keybindings registered via `useBindings` (from `@opencode-ai/tui/keymap`) are handled by a centralized keymap layer that also runs before panel-level `useKeyboard` handlers.

**Result:** Any key that had *any* global handler would be consumed before the drill-down handler ran. Keys without a global handler (e.g. a novel ctrl+combo) might work, but were never confirmed working due to a second problem:

### Why state change didn't produce a re-render

The drill-down was developed and tested inside a Docker/Podman container. The container image was not rebuilt between code changes. Stale compiled output meant that even when the logic was correct, the running binary didn't reflect the change. This made it impossible to distinguish "key not received" from "state change not triggering re-render."

---

## What Was Not Tried

- Using a dedicated second pane / split-panel layout instead of swapping the list in-place.
- A modal overlay (separate z-layer) rendered outside `PanelShell`.
- Triggering drill-down from the `footer.view.tsx` level, where the panel lifecycle is controlled, instead of inside `RunSkillSelectBody`.
- A dedicated unique key (e.g. `?` or `i`) that has **no** handler anywhere else in the TUI, verified by grepping the entire codebase first.
- Confirming the container was rebuilt and running fresh code before testing any key combination.

---

## Lessons for Future Attempts

1. **Rebuild the container before testing any keyboard change.** Stale images cause false negatives that waste hours.
2. **Grep all existing key handlers before choosing a shortcut.** Check `footer.command.tsx`, `footer.view.tsx`, `footer.prompt.tsx`, `packages/tui/src/keymap.tsx`, and `packages/tui/src/config/keybind.ts`.
3. **Do not swap content inside `PanelShell`.** The input element inside `PanelShell` captures focus and key events; replacing its sibling content while keeping the input alive is fragile.
4. **Verify keyboard plumbing with a console log first.** Before wiring real UI, add a `console.error("DRILL KEY HIT")` to confirm the handler actually fires in the running process.
5. **Consider a different UX pattern.** The description is short — showing it inline as a second line in the list row (already partially done via `description` field on `SkillEntry`) may be simpler and more reliable than a full drill-down panel swap.
