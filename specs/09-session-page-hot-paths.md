## Session hot paths

Reduce render work and duplication in `session.tsx`

---

### Summary

`packages/app/src/pages/session.tsx` mixes routing, commands, tab rendering, review panel wiring, terminal focus logic, and message scrolling. This spec targets hot-path performance + local code quality improvements that can ship together in one session-page-focused PR. It should follow the keyed command-registration pattern introduced in `packages/app/src/context/command.tsx`.

---

### Goals

- Render heavy file-tab content only for the active tab
- Deduplicate review-panel wiring used in desktop and mobile paths
- Centralize terminal-focus DOM logic into one helper
- Reduce churn in command registration setup

---

### Non-goals

- Scroll-spy rewrite (covered by `specs/04-scroll-spy-optimization.md`)
- Large routing/layout redesign
- Behavior changes to prompt submission or session history

---

### Parallel execution contract

This spec owns:

- `packages/app/src/pages/session.tsx`
- New files under `packages/app/src/pages/session/*` (if extracted)

This spec should not modify:

- `packages/app/src/context/*`
- `packages/app/src/components/prompt-input.tsx`
- `packages/app/src/components/file-tree.tsx`

---

### Implementation plan

1. Add shared helpers for repeated session-page actions

- Extract `openReviewFile(path)` helper to replace repeated inline `onViewFile` bodies.
- Extract `focusTerminalById(id)` helper and reuse in both:
  - terminal active change effect
  - terminal drag-end focus restoration

2. Deduplicate review panel construction

- Build a shared review props factory (or local render helper) so desktop/mobile paths do not duplicate comment wiring, `onViewFile`, and classes glue.
- Keep per-surface differences limited to layout classes and diff style.

3. Gate heavy file-tab rendering by active tab

- Keep tab trigger list rendered for all opened tabs.
- Render `Tabs.Content` body only for `activeTab()`, plus lightweight placeholders as needed.
- Ensure per-tab scroll state restore still works when reactivating a tab.

4. Reduce command registry reallocation

- Register session commands with a stable key (`command.register("session", ...)`) so remounts replace prior session command entries.
- Move large command-array construction into smaller memoized blocks:
  - stable command definitions
  - dynamic state fields (`disabled`, titles) as narrow computed closures
  - Keep command IDs, keybinds, and behavior identical.

---

### Acceptance criteria

- File tab bodies are not all mounted at once for large open-tab sets.
- `onViewFile` review behavior is defined in one shared helper.
- Terminal focus query/dispatch logic lives in one function and is reused.
- Session command registration uses a stable key (`"session"`) and `command.register` no longer contains one monolithic inline array with repeated inline handlers for shared actions.
- Session UX remains unchanged for:
  - opening files from review
  - drag-reordering terminal tabs
  - keyboard command execution

---

### Validation plan

- Manual:
  - Open 12+ file tabs, switch quickly, verify active tab restore and no blank states.
  - Open review panel (desktop and mobile), use "view file" from diffs, verify same behavior as before.
  - Drag terminal tab, ensure terminal input focus is restored.
  - Run key commands: `mod+p`, `mod+w`, `mod+shift+r`, `ctrl+``.
- Perf sanity:
  - Compare CPU usage while switching tabs with many opened files before/after.

---

### Risks and mitigations

- Risk: unmounted tab content loses transient editor state.
  - Mitigation: keep persisted scroll/selection restore path intact and verify reactivation behavior.
- Risk: command refactor subtly changes command ordering.
  - Mitigation: keep IDs and registration order stable, diff against current command list in dev.
