# Footer Agent Activity Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a toggleable `e`-key detail panel to the mini footer that shows per-child agent label, active tool name, truncated input preview, and elapsed time — making stuck MCP calls and hung shells visible without leaving the parent session.

**Architecture:** Four files are touched in dependency order: extend the type, populate the new fields in the tab snapshot function, add a pure helper with tests, then wire the view toggle. No new files. No changes to `stream-v2.transport.ts`.

**Tech Stack:** TypeScript, SolidJS signals, bun test

## Global Constraints

- Mini TUI only (`packages/tui/src/mini/`). Full TUI is out of scope.
- Read-only panel — no actions on children.
- No new files — changes land in the five files listed in the spec.
- Run tests with `bun test packages/tui/src/mini/session-data.test.ts`.

---

## File Map

| File | Role |
|---|---|
| `packages/tui/src/mini/types.ts` | Type vocabulary. Add `activeTool?` and `toolStart?` to `FooterSubagentTab`. |
| `packages/tui/src/mini/stream-v2.subagent.ts` | Tab snapshot. `tab()` reads from `ChildState.tools` to populate new fields. |
| `packages/tui/src/mini/session-data.ts` | Pure helpers. Add `ToolSummaryRow` interface and `activeToolSummaries()`. |
| `packages/tui/src/mini/session-data.test.ts` | Unit tests. Add `describe("activeToolSummaries", ...)` block. |
| `packages/tui/src/mini/footer.view.tsx` | View. Add `expanded` signal, `e` key layer, expanded render branch, `[e] agents` hint. |

---

### Task 1: Extend `FooterSubagentTab` type

**Files:**
- Modify: `packages/tui/src/mini/types.ts:316-323`

**Interfaces:**
- Produces: `FooterSubagentTab.activeTool?: string`, `FooterSubagentTab.toolStart?: number` — used by Tasks 2, 3, and 4.

- [ ] **Step 1: Add two optional fields to `FooterSubagentTab`**

Open `packages/tui/src/mini/types.ts` and change the `FooterSubagentTab` type at line 316. Replace:

```ts
export type FooterSubagentTab = {
  sessionID: string
  label: string
  description: string
  status: "running" | "completed" | "cancelled" | "error"
  title?: string
  model?: { providerID: string; modelID: string }
}
```

With:

```ts
export type FooterSubagentTab = {
  sessionID: string
  label: string
  description: string
  status: "running" | "completed" | "cancelled" | "error"
  title?: string
  model?: { providerID: string; modelID: string }
  activeTool?: string
  toolStart?: number
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/I048057/dev/opencode && bunx tsc --noEmit -p packages/tui/tsconfig.json 2>&1 | head -40
```

Expected: no new errors (there may be pre-existing errors in unrelated files — only errors that mention `FooterSubagentTab`, `activeTool`, or `toolStart` are regressions).

- [ ] **Step 3: Commit**

```bash
git -c commit.gpgsign=false commit -m "feat(tui): add activeTool/toolStart to FooterSubagentTab (#65680)" packages/tui/src/mini/types.ts
```

---

### Task 2: Populate `activeTool` and `toolStart` in the tab snapshot

**Files:**
- Modify: `packages/tui/src/mini/stream-v2.subagent.ts:190-199`

**Interfaces:**
- Consumes: `ChildState.tools: Map<string, ToolTrack>` — each value is `{ part: SessionMessageAssistantTool }`. Tool name is `normalizeTool(part).name`; start time is `part.time.created` (epoch ms). Tools in the map have `state.status === "running"` or `"streaming"` (completed tools are deleted with `child.tools.delete(key)` at line 328).
- Produces: `FooterSubagentTab.activeTool?: string`, `FooterSubagentTab.toolStart?: number`

Background: `ChildState.tools` is a `Map<string, ToolTrack>`. A tool enters the map when `session.tool.input.started` fires (`status: "streaming"`) and when `session.tool.called` fires (`status: "running"`). A tool is deleted from the map on `session.tool.success` / `session.tool.failed`. So any entry in the map is currently active. We want the **most recently started** tool (highest `part.time.created` or `part.time.ran`).

- [ ] **Step 1: Update the `tab()` function in `stream-v2.subagent.ts`**

The `tab()` function is at lines 190–199. Replace it with:

```ts
function tab(child: ChildState): FooterSubagentTab {
  let activeTool: string | undefined
  let toolStart: number | undefined
  for (const { part } of child.tools.values()) {
    const start = part.time.ran ?? part.time.created
    if (toolStart === undefined || start > toolStart) {
      activeTool = part.name
      toolStart = start
    }
  }
  return {
    sessionID: child.sessionID,
    label: child.label,
    description: child.description || child.title || "",
    status: child.status,
    title: child.title,
    model: child.model,
    activeTool,
    toolStart,
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/I048057/dev/opencode && bunx tsc --noEmit -p packages/tui/tsconfig.json 2>&1 | head -40
```

Expected: no new errors related to `tab()`, `activeTool`, or `toolStart`.

- [ ] **Step 3: Commit**

```bash
git -c commit.gpgsign=false commit -m "feat(tui): populate activeTool/toolStart in tab snapshot (#65680)" packages/tui/src/mini/stream-v2.subagent.ts
```

---

### Task 3: Add `ToolSummaryRow` and `activeToolSummaries()` with tests

**Files:**
- Modify: `packages/tui/src/mini/session-data.ts`
- Modify: `packages/tui/src/mini/session-data.test.ts`

**Interfaces:**
- Consumes: `FooterSubagentTab` from Task 1 — specifically `status`, `label`, `activeTool`, `toolStart`.
- Produces:
  - `ToolSummaryRow` interface with `{ label: string; tool: string; inputPreview: string; elapsedMs: number }`
  - `activeToolSummaries(descendant: FooterSubagentState, now: number): ToolSummaryRow[]`
  - Exported from `session-data.ts`; consumed by Task 4 in `footer.view.tsx`.

Note: `inputPreview` is intentionally empty string in this helper — the tab snapshot carries tool name and start time, but not the input JSON (input lives in `ChildState.tools` which is not part of the public tab state). The view in Task 4 will display `inputPreview` as-is; for first cut this is an empty string. If input preview is added later, it flows through `FooterSubagentTab.toolInput?` (future field) without changing this helper's signature.

- [ ] **Step 1: Write failing tests first**

Add to `packages/tui/src/mini/session-data.test.ts`. Append after the last `describe` block (around line 122):

```ts
import { activeToolSummaries } from "./session-data"

describe("activeToolSummaries", () => {
  const makeTab = (
    overrides: Partial<import("./types").FooterSubagentTab>,
  ): import("./types").FooterSubagentTab => ({
    sessionID: "ses_test",
    label: "developer",
    description: "",
    status: "running",
    ...overrides,
  })

  const makeState = (
    tabs: import("./types").FooterSubagentTab[],
  ): import("./types").FooterSubagentState => ({
    tabs,
    details: {},
    permissions: [],
    forms: [],
  })

  it("returns empty array when no running tabs", () => {
    const result = activeToolSummaries(
      makeState([makeTab({ status: "completed" })]),
      Date.now(),
    )
    expect(result).toEqual([])
  })

  it("includes running tab with no active tool", () => {
    const result = activeToolSummaries(makeState([makeTab({})]), Date.now())
    expect(result).toHaveLength(1)
    expect(result[0]!.tool).toBe("")
    expect(result[0]!.elapsedMs).toBe(0)
    expect(result[0]!.label).toBe("developer")
  })

  it("includes running tab with active tool", () => {
    const now = Date.now()
    const result = activeToolSummaries(
      makeState([makeTab({ activeTool: "mcp__filesystem__read_file", toolStart: now - 5000 })]),
      now,
    )
    expect(result).toHaveLength(1)
    expect(result[0]!.tool).toBe("mcp__filesystem__read_file")
    expect(result[0]!.elapsedMs).toBeGreaterThanOrEqual(4900)
    expect(result[0]!.elapsedMs).toBeLessThanOrEqual(5100)
  })

  it("returns one row per running tab", () => {
    const now = Date.now()
    const result = activeToolSummaries(
      makeState([
        makeTab({ sessionID: "ses_a", label: "developer", activeTool: "bash", toolStart: now - 1000 }),
        makeTab({ sessionID: "ses_b", label: "researcher", activeTool: "websearch", toolStart: now - 2000 }),
        makeTab({ sessionID: "ses_c", label: "done", status: "completed" }),
      ]),
      now,
    )
    expect(result).toHaveLength(2)
    expect(result[0]!.label).toBe("developer")
    expect(result[1]!.label).toBe("researcher")
  })

  it("inputPreview is empty string (input not in tab snapshot)", () => {
    const result = activeToolSummaries(
      makeState([makeTab({ activeTool: "bash", toolStart: Date.now() })]),
      Date.now(),
    )
    expect(result[0]!.inputPreview).toBe("")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/I048057/dev/opencode && bun test packages/tui/src/mini/session-data.test.ts 2>&1 | tail -20
```

Expected: test failures like `activeToolSummaries is not a function` or import errors.

- [ ] **Step 3: Add `ToolSummaryRow` and `activeToolSummaries` to `session-data.ts`**

Append to the end of `packages/tui/src/mini/session-data.ts`:

```ts
export interface ToolSummaryRow {
  label: string
  tool: string
  inputPreview: string
  elapsedMs: number
}

export function activeToolSummaries(
  descendant: FooterSubagentState,
  now: number,
): ToolSummaryRow[] {
  return descendant.tabs
    .filter((tab) => tab.status === "running")
    .map((tab) => ({
      label: tab.label || tab.sessionID,
      tool: tab.activeTool ?? "",
      inputPreview: "",
      elapsedMs: tab.toolStart !== undefined ? Math.max(0, now - tab.toolStart) : 0,
    }))
}
```

Also update the import line at the top of `session-data.test.ts` to include `activeToolSummaries`:

```ts
import { descendantActivityModel, descendantActivityStatus, footerActivityStatus, activeToolSummaries } from "./session-data"
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/I048057/dev/opencode && bun test packages/tui/src/mini/session-data.test.ts 2>&1 | tail -20
```

Expected: all tests pass, 0 failures.

- [ ] **Step 5: Commit**

```bash
git -c commit.gpgsign=false commit -m "feat(tui): add activeToolSummaries helper + tests (#65680)" packages/tui/src/mini/session-data.ts packages/tui/src/mini/session-data.test.ts
```

---

### Task 4: Add expanded panel to `footer.view.tsx`

**Files:**
- Modify: `packages/tui/src/mini/footer.view.tsx`

**Interfaces:**
- Consumes: `ToolSummaryRow`, `activeToolSummaries` from Task 3; `FooterSubagentTab.activeTool`/`toolStart` from Task 1.
- Guard logic: `expanded` state only toggles when `activeTabs().length > 0`.
- The expanded panel replaces the normal statusline when `expanded()` is true and `activeTabs().length > 0`.

This task has four sub-steps: (a) add import, (b) add `expanded` signal, (c) add `e` key layer, (d) add expanded render branch + `[e] agents` hint.

- [ ] **Step 1: Add import for `activeToolSummaries` and `ToolSummaryRow`**

In `footer.view.tsx`, the import from `./session-data` is currently at line 38:

```ts
import { descendantActivityModel } from "./session-data"
```

Change it to:

```ts
import { activeToolSummaries, descendantActivityModel } from "./session-data"
```

- [ ] **Step 2: Add `expanded` signal and `toolSummaries` memo**

After the existing signal declarations in `RunFooterView` (around line 364 where `const [promptRows, setPromptRows] = createSignal(1)` is), add:

```ts
const [expanded, setExpanded] = createSignal(false)
const toolSummaries = createMemo(() =>
  expanded() ? activeToolSummaries(subagent(), performance.now()) : [],
)
```

- [ ] **Step 3: Add `e` key layer**

Add a new `Keymap.createLayer` block after the existing `session.child.first` layer (which ends around line 589). Place it after that block:

```ts
Keymap.createLayer(() => ({
  enabled: active().type === "prompt" && route().type === "composer" && activeTabs().length > 0,
  commands: [
    {
      id: "session.child.activity",
      title: "Toggle agent activity panel",
      group: "Session",
      run: () => setExpanded((v) => !v),
    },
  ],
}))
```

Then register the keybind. The `Keymap.createLayer` method accepts a `keys` map; to bind `e`, the layer needs a `keys` field. The pattern used by existing layers in this file is to bind via the keymap config (the user's `keybinds` setting). For this feature, use a direct `keys` map on the layer instead so it works out of the box:

```ts
Keymap.createLayer(() => ({
  enabled: active().type === "prompt" && route().type === "composer" && activeTabs().length > 0,
  keys: { e: "session.child.activity" },
  commands: [
    {
      id: "session.child.activity",
      title: "Toggle agent activity panel",
      group: "Session",
      run: () => setExpanded((v) => !v),
    },
  ],
}))
```

Also add an effect to auto-collapse when all children finish (guards against stale expanded state):

```ts
createEffect(() => {
  if (activeTabs().length === 0) setExpanded(false)
})
```

- [ ] **Step 4: Add `[e] agents` hint to `contextHintCandidates`**

The `contextHintCandidates` memo is at lines 455–473. The existing items array already pushes a `subagents` entry. Add an `activity` entry when `expanded()` is true:

Replace the `items.push` for `subagents`:

```ts
if (activeTabs().length > 0 && subagentShortcut()) {
  items.push({
    id: "subagents",
    key: subagentShortcut(),
    label: `${activeTabs().length} sub`,
    expanded: `${activeTabs().length} subagent${activeTabs().length === 1 ? "" : "s"}`,
  })
}
```

With:

```ts
if (activeTabs().length > 0 && subagentShortcut()) {
  items.push({
    id: "subagents",
    key: subagentShortcut(),
    label: `${activeTabs().length} sub`,
    expanded: `${activeTabs().length} subagent${activeTabs().length === 1 ? "" : "s"}`,
  })
}
if (activeTabs().length > 0) {
  items.push({
    id: "activity" as const,
    key: "e",
    label: expanded() ? "hide" : "agents",
  })
}
```

Note: `contextHintCandidates` has type `Array<{ id: "queued" | "subagents"; ... }>`. You need to widen the `id` union. Find the type annotation for `items` in the memo (it is inferred inline) and either cast the new entry or widen the array type. The simplest fix is to type the array explicitly:

```ts
const items: Array<{ id: "queued" | "subagents" | "activity"; key: string; label: string; expanded?: string }> = []
```

- [ ] **Step 5: Add the expanded render branch**

The normal statusline `<Show when={!panel() && !menu()}>` block is at lines 959–997. It renders the spinner + `statusSections`. Wrap it so when `expanded()` is true and there are running tabs, the expanded panel renders instead.

Change:

```tsx
<Show when={!panel() && !menu()}>
  <box
    id="mini-statusline"
    ...
  >
    ...
  </box>
</Show>
```

To:

```tsx
<Show when={!panel() && !menu()}>
  <Show
    when={expanded() && activeTabs().length > 0}
    fallback={
      <box
        id="mini-statusline"
        width="100%"
        flexDirection="row"
        gap={1}
        flexShrink={0}
        backgroundColor="transparent"
      >
        <Show when={busy()}>
          <box id="mini-work-spinner" width={1} flexShrink={0}>
            <OneCellSpinner
              animation={props.mono ? SEED_MONO : WORK_SPINNERS[props.miniSettings().work_spinner]}
              color={agentColor()}
              animations={props.tuiConfig.animations}
              glow={!props.mono}
              still={props.mono ? "*" : undefined}
              age={performance.now() - (started() ?? performance.now())}
            />
          </box>
        </Show>
        <Show when={statusSections().length > 0}>
          <text fg={statusColor()} wrapMode="word" width={statusWidth()} flexShrink={0} height={statusRows()}>
            <For each={statusSections()}>
              {(section, index) => (
                <>
                  <Show when={index() > 0}>
                    <span style={{ fg: theme().muted }}>{props.mono ? " - " : " · "}</span>
                  </Show>
                  <For each={section.parts}>
                    {(part) => <span style={{ fg: statusColors()[part.tone] }}>{part.text}</span>}
                  </For>
                </>
              )}
            </For>
          </text>
        </Show>
      </box>
    }
  >
    <box
      id="mini-agent-activity"
      width="100%"
      flexDirection="column"
      flexShrink={0}
      backgroundColor="transparent"
    >
      <For each={toolSummaries()}>
        {(row) => (
          <box width="100%" flexDirection="row" gap={1} flexShrink={0}>
            <text fg={theme().text} flexShrink={0}>
              {row.label}
            </text>
            <text fg={theme().muted} flexShrink={0}>
              {props.mono ? " - " : " · "}
            </text>
            <text fg={row.tool ? theme().text : theme().muted} flexShrink={0}>
              {row.tool || "—"}
            </text>
            <text fg={theme().muted} flexShrink={1} wrapMode="none">
              {row.elapsedMs > 0
                ? `  ${Math.round(row.elapsedMs / 1000)}s`
                : ""}
            </text>
            <box width={1} flexShrink={0}>
              <OneCellSpinner
                animation={props.mono ? SEED_MONO : WORK_SPINNERS[props.miniSettings().work_spinner]}
                color={agentColor()}
                animations={props.tuiConfig.animations}
                glow={!props.mono}
                still={props.mono ? "*" : undefined}
                age={performance.now() - (started() ?? performance.now())}
              />
            </box>
          </box>
        )}
      </For>
    </box>
  </Show>
</Show>
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd /Users/I048057/dev/opencode && bunx tsc --noEmit -p packages/tui/tsconfig.json 2>&1 | head -40
```

Fix any type errors before proceeding.

- [ ] **Step 7: Run the full mini test suite**

```bash
cd /Users/I048057/dev/opencode && bun test packages/tui/src/mini/session-data.test.ts 2>&1
```

Expected: all existing tests pass + 5 new `activeToolSummaries` tests pass.

- [ ] **Step 8: Manual smoke test**

Start opencode with an orchestrator prompt that spawns a subagent (e.g. `/new` then `use the developer agent to list files in this directory`). While the subagent is running:
1. Verify footer shows `task:developer · ses_xxx` as before (collapsed state).
2. Press `e` — verify expanded panel appears with agent label and tool name.
3. Press `e` again — verify collapse.
4. If no subagent available, verify the `e` key does nothing when no children are running.

- [ ] **Step 9: Commit**

```bash
git -c commit.gpgsign=false commit -m "feat(tui): footer agent activity panel with e-key toggle (#65680)" packages/tui/src/mini/footer.view.tsx
```

---

## Completion Checklist

- [ ] `FooterSubagentTab` has `activeTool?` and `toolStart?`
- [ ] `tab()` populates those fields from `ChildState.tools`
- [ ] `activeToolSummaries()` exported from `session-data.ts`
- [ ] All `activeToolSummaries` unit tests pass
- [ ] `e` key toggles expanded panel only when ≥1 child running
- [ ] Expanded panel shows label + tool + elapsed per running child
- [ ] `[e] agents` hint appears in footer hint bar when children are running
- [ ] Panel auto-collapses when all children finish
- [ ] TypeScript compiles without new errors
- [ ] All pre-existing `session-data.test.ts` tests still pass
