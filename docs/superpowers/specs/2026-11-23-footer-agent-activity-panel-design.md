# Footer Agent Activity Panel — Design Spec

**Issue:** #65680  
**Date:** 2026-11-23  
**Status:** Approved for implementation

## Problem

When an orchestrator spawns subagents, the mini footer shows only `task:developer · ses_abc123` while a child is active. There is no way to tell what tool the child is waiting on without leaving the parent session. A downed MCP server or hung shell call is invisible.

## Goal

Add a toggleable detail panel (key `e`) to the mini footer that shows, per running child: agent label, active tool name, truncated input preview, and elapsed time. Toggle is manual — the panel stays open until the user dismisses it.

## Scope

- Read-only diagnostic view; no actions on children from the panel.
- First cut: active tool + elapsed + input preview only. No partial output (adds noise, addressed separately if needed).
- Mini TUI only (`packages/tui/src/mini/`). Full TUI is out of scope.

---

## Data Model

Extend `FooterSubagentTab` in `mini/types.ts`:

```ts
export interface FooterSubagentTab {
  sessionID: string
  label: string
  description: string
  status: "running" | "completed" | "error" | string
  title?: string
  model?: { providerID: string; modelID: string }
  activeTool?: string    // name of the tool currently executing in this child
  toolStart?: number     // Date.now() when that tool started (ms)
}
```

`activeTool` is `undefined` when the child is active but not inside a tool call. `toolStart` is `undefined` whenever `activeTool` is.

---

## Data Flow

```
ChildState.tools (Map<string, ToolTrack>)
  → toolTabPatch() in stream-v2.subagent.ts
  → FooterSubagentTab.activeTool / toolStart
  → syncBlockers (stream-v2.transport.ts) patches footer state
  → footer.view.tsx reads tab fields
```

`ChildState.tools` already tracks `ToolTrack.part.name` (tool name) and `ToolTrack.startTime` (epoch ms). The patch function reads the most recently started tool entry from `ChildState.tools` (highest `toolStart`) and copies the two fields into the tab snapshot. If a child runs multiple tools in parallel, only the most recently started is shown — this covers the common case (sequential calls) and the diagnostic case (one hung call). No changes to `stream-v2.transport.ts`; the tab patch is part of the existing `footerPatch` path.

---

## Helper: `activeToolSummaries`

New export in `mini/session-data.ts`:

```ts
export interface ToolSummaryRow {
  label: string        // agent label (or "subagent")
  tool: string         // tool name, or "" if no active tool
  inputPreview: string // JSON.stringify(tool input), truncated to 30 chars with "…"
  elapsedMs: number    // Date.now() - toolStart, 0 if toolStart undefined
}

export function activeToolSummaries(
  descendant: FooterSubagentState,
  now: number,
): ToolSummaryRow[]
```

Returns one row per child tab with `status === "running"`. Tested in `session-data.test.ts`.

---

## View: Toggle and Expanded Render

**Signal:** `const [expanded, setExpanded] = createSignal(false)` in `footer.view.tsx`.

**Key binding:** `e` added to the existing key handler block. Guard: only fires when `descendant.tabs.some(t => t.status === "running")`. Pressing `e` again collapses.

**Collapsed (unchanged):** footer row shows `task:developer · ses_abc123` as today, plus a right-aligned hint `[e] agents` when ≥1 child is running.

**Expanded:** the status text area is replaced with one line per running child (the normal status line is hidden):

```
developer  mcp__filesystem__read_file  "src/session-data.ts…"   12s  ↻
researcher  bash                        "bun test …"              4s  ↻
```

Columns (tab-separated, truncated to terminal width):  
`label | tool (or "—") | input preview (30 chars, quoted) | elapsed | spinner`

If a child is running but has no active tool, the tool column shows `—` and input preview is empty.

The panel stays open until the user presses `e` again (manual dismiss). It does not auto-collapse when children finish.

---

## Files Touched

| File | Change |
|---|---|
| `mini/types.ts` | Add `activeTool?`, `toolStart?` to `FooterSubagentTab` |
| `mini/stream-v2.subagent.ts` | Populate new fields in `toolTabPatch` |
| `mini/session-data.ts` | Add `ToolSummaryRow` type + `activeToolSummaries()` |
| `mini/session-data.test.ts` | Tests for `activeToolSummaries` |
| `mini/footer.view.tsx` | `expanded` signal, `e` key handler, expanded render branch, `[e] agents` hint |

No new files. No changes to `stream-v2.transport.ts`.

---

## Testing

- Unit: `activeToolSummaries` in `session-data.test.ts` — no active tool, one active tool, multiple active children, elapsed calculation.
- Manual: orchestrator → developer subagent; press `e`; verify tool name and elapsed appear; press `e` again; verify collapse.

---

## Out of Scope

- Partial output preview (follow-up issue if needed)
- Actions on children from the panel
- Full TUI
- Keyboard navigation between child rows
