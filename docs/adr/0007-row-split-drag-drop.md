# ADR-0007: L1/L2 行上下分区拖拽重设计

**Status:** Accepted (2026-07-20)
**Branch:** `feature/todo-sidebar-linear`
**Deciders:** user, Claude
**Related:** ADR-0001 Amendment 2026-07-20 D1 (`getTree` superseded — tree structure assembled on frontend), ADR-0001 D2 (deferred persistent sidebar section)

## Context

ADR-0001 Amendment 2026-07-20 documented the **current** L2 drag-reparenting implementation (5 allowed drag paths: L1→L1 reorder, L2→L2 same-parent reorder, L2→L2 different-parent reparent+insert, L2→L1 reparent to L2 list, L1→L2 rejected). The L2→L1 reparent path requires the user to drop the L2 onto the L1 row itself.

### Problem

When an L2 needs to be moved under an L1 that currently has no L2 children, the user must drop the L2 **onto the L1 row**. This is counter-intuitive because:

1. The L1 row is simultaneously the drop target for L1↔L1 reordering and L2→L1 reparent — the two semantics are visually indistinguishable.
2. An L1 with no L2 children shows no chevron, giving no visual hint that "you can drop a child here."
3. The user's mental model is "drop below = becomes child," but the implementation requires "drop onto the row."
4. When the target L1 is followed by another L1, dropping below triggers L1↔L1 reordering instead of reparent.

The user explicitly rejected approaches that render additional drop-zone elements below each L1 during drag (high reflow cost, excessive vertical space occupation).

## Decision

Adopt a **single-drop-target with Y-coordinate partitioning** model, inspired by VSCode's file tree. Each L1/L2 row is the sole drop target; the mouse's Y position within the row determines the semantic.

### Core rule

Each row is split into two zones at a **2:1 ratio** (upper 2/3 = "before", lower 1/3 = "after"). The 2:1 bias toward the upper zone reflects that reordering (the dominant operation for L1 drags) is the primary scenario.

### Unified mental model

- **Upper zone = "before"**, **lower zone = "after"**.
- **L1 being dragged**: always reorders. Target is L1 → insert before/after target. Target is L2 → insert before/after target's parent L1.
- **L2 being dragged**:
  - Target is L1 → reparent (upper = previous sibling L1, lower = this L1, first L1 upper = this L1).
  - Target is L2 same-parent → reorder (before/after).
  - Target is L2 cross-parent → reparent + position (becomes child of target's parent L1, inserted before/after target).

### Complete behavior matrix (10 scenarios)

| # | Drag | Drop target | Zone | Action |
|---|------|-------------|------|--------|
| ① | L1 | L1 | upper | Reorder: insert before target L1 |
| ② | L1 | L1 | lower | Reorder: insert after target L1 |
| ③ | L1 | L2 | upper/lower | Reorder: insert before/after target's parent L1 |
| ④ | L2 | L1 (non-first) | upper | Reparent: become child of target's previous sibling L1 |
| ⑤ | L2 | L1 (first) | upper | Reparent: become child of target L1 (merge upper/lower semantics) |
| ⑥ | L2 | L1 | lower | Reparent: become child of target L1 |
| ⑦ | L2 | L2 (same parent) | upper | Reorder: insert before target L2 |
| ⑧ | L2 | L2 (same parent) | lower | Reorder: insert after target L2 |
| ⑨ | L2 | L2 (cross parent) | upper | Reparent + position: become child of target's parent L1, insert before target L2 |
| ⑩ | L2 | L2 (cross parent) | lower | Reparent + position: become child of target's parent L1, insert after target L2 |

There are **no "disallowed" drag scenarios** — every drag maps to a reorder or reparent action.

### Visual feedback

**Zero visual placeholders.** No indicator lines, no background color changes during drag hover. The user relies on:

- The HTML5 Drag API's default semi-transparent clone following the cursor.
- The list re-rendering immediately on drop to reflect the new order.
- Muscle memory developed through repeated use: "upper half = before, lower half = after."

If the API call fails on drop, the list rolls back to its previous order.

### Why 2:1 (upper-biased) partition

- Reordering is the dominant operation for L1 drags; a larger upper zone makes "insert before" easier to trigger.
- Reparent (L2→L1 lower) is the secondary scenario; the smaller lower zone is still easily hittable.
- A 50:50 split would require more precise mouse positioning without providing any benefit.

## Consequences

### Positive

- **Single drop target per row** — no additional DOM elements, zero reflow cost during drag.
- **Unified mental model** — "before/after" applies to both L1 and L2 drags, reducing cognitive load.
- **No disallowed drags** — every drag has a defined behavior, eliminating dead zones.
- **L2 reparent to childless L1 is now intuitive** — drop on the L1's lower zone = becomes child.

### Negative

- **No visual feedback during drag** — users must learn the upper/lower convention through experimentation. Mitigation: the behavior is consistent and predictable, so muscle memory forms quickly.
- **First L1 upper zone special case** — scenario ⑤ merges upper/lower semantics for the first L1 only. This is a minor inconsistency but necessary to avoid a dead zone.
- **L1→L2 drag resolves to L1 reordering** — scenario ③ may surprise users who expect L1→L2 to do something else. Mitigation: this matches the "L1 never becomes L2" invariant.

### Neutral

- The 2:1 ratio is a constant; future tuning (e.g., dynamic based on row height) is possible but not planned.

## Implementation notes

- The drag-drop provider in `packages/app/src/pages/layout/sidebar-todo.tsx` currently uses a flat `DragDropProvider` with a dynamic `allSortableIds` memo. The Y-coordinate partitioning requires intercepting the drop event to read `event.clientY` and compare against the target row's `getBoundingClientRect()`.
- The 10-scenario matrix maps to the existing `issue.update({ patch: { parent_id } })` + `issue.reorder({ ids })` two-step process. Scenarios ④⑤⑥⑨⑩ trigger both calls; scenarios ①②③⑦⑧ trigger only `issue.reorder`.
- Rollback on API failure: keep a snapshot of the current order/parent map before the optimistic update; restore on error.

## Open questions

None. All 10 scenarios have defined behavior.
