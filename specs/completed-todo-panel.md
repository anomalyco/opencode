# Completed Todo panel visibility

Status: proposed; awaiting design review before implementation.

Related: https://github.com/anomalyco/opencode/issues/51535

## Problem

The TUI's Todo sidebar section disappears when every item is completed. Users
cannot review the finished checklist in the sidebar after the agent finishes,
even though those todos remain in the session.

## Proposed behavior

Add a command-palette toggle: **Keep completed Todo panel visible**.

- Default off: retain the existing all-completed hiding behavior.
- On: show a non-empty list even when all its items are completed.
- Remember the preference globally in the existing TUI KV store across session
  switches and restarts.
- Keep the current click-to-collapse behavior independent of the toggle.
- Continue showing the current session's list; a new list replaces the previous
  one, and an empty list still hides the section.
- Preserve the existing rendering of completed items in mixed lists and the
  existing visibility of cancelled items.

The toggle controls the built-in agent Todo section, not a personal backlog
plugin or the entire sidebar. It changes display behavior only; todo statuses
and agent execution are unaffected.

## Implementation plan

1. Add a palette command and persisted preference in the built-in sidebar Todo
   feature at `packages/tui/src/feature-plugins/sidebar/todo.tsx`.
2. Make the section's visibility react to that preference and the session's
   current todo list. Reuse the existing Todo item component.
3. Add regression tests and document the palette command in the TUI guide.

## Verification plan

- Check empty, all-completed, mixed, pending, in-progress, and cancelled lists
  with the toggle on and off.
- Confirm the section updates immediately when toggled after completion.
- Confirm preference restoration across session switches and restarts.
- Confirm collapse/expand still works independently of completion visibility.
- Run the relevant package tests and type checks, and attach before/after TUI
  captures to the implementation PR update.

## Design question

Is a persisted command-palette toggle sufficient, or should the same preference
also have a `tui.json` default? This draft proposes the smaller palette-only
change first and leaves the final command and preference names for review.
