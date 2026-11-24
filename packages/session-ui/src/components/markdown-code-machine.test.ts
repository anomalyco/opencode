import { describe, expect, test } from "bun:test"
import {
  EMPTY_CODE_EFFECTS,
  INITIAL_CODE_DECORATION_STATE,
  transitionCodeDecoration,
  viewCodeDecoration,
  type CodeDecorationEvent,
  type CodeDecorationState,
} from "./markdown-code-machine"

const sync = (source: string, complete: boolean, language = "mermaid") =>
  ({ type: "sync", language, source, complete, match: undefined }) as const

function run(events: CodeDecorationEvent[], state = INITIAL_CODE_DECORATION_STATE) {
  return events.reduce(
    (result, event) => {
      const next = transitionCodeDecoration(result.state, event)

      return { state: next.state, effects: next.effects }
    },
    { state, effects: EMPTY_CODE_EFFECTS },
  )
}

function svg(state: CodeDecorationState) {
  return viewCodeDecoration(state).svg
}

const claim = (language: string) => ({ render: new Set([language]), actions: new Set<string>() })

describe("markdown code decoration", () => {
  test("keeps plain code on the same state with no effects", () => {
    const match = claim("python")

    const first = transitionCodeDecoration(INITIAL_CODE_DECORATION_STATE, {
      type: "sync",
      language: "ts",
      source: "const a",
      complete: false,
      match,
    })

    const second = transitionCodeDecoration(first.state, {
      type: "sync",
      language: "ts",
      source: "const a = 1",
      complete: false,
      match,
    })

    expect(first.state).toBe(INITIAL_CODE_DECORATION_STATE)
    expect(second.state).toBe(INITIAL_CODE_DECORATION_STATE)
    expect(second.effects).toBe(EMPTY_CODE_EFFECTS)
  })

  test("ignores a slow render of earlier streamed lines once a newer diagram rendered", () => {
    const started = run([sync("flowchart LR\nA --> B\n", false), sync("flowchart LR\nA --> B\nB --> C", true)])

    expect(started.effects).toEqual([{ type: "render-mermaid", attempt: 2, input: "flowchart LR\nA --> B\nB --> C" }])
    const newer = transitionCodeDecoration(started.state, { type: "mermaid.resolved", attempt: 2, svg: "<svg>2</svg>" })
    const older = transitionCodeDecoration(newer.state, { type: "mermaid.resolved", attempt: 1, svg: "<svg>1</svg>" })

    expect(svg(newer.state)).toBe("<svg>2</svg>")
    expect(older.state).toBe(newer.state)
    expect(older.effects).toBe(EMPTY_CODE_EFFECTS)
  })

  test("renders a replaced diagram of the same length", () => {
    const ready = run([
      sync("flowchart LR\nA --> B", true),
      { type: "mermaid.resolved", attempt: 1, svg: "<svg>1</svg>" },
    ])

    const replaced = transitionCodeDecoration(ready.state, sync("flowchart TD\nX --> Y", true))

    expect(replaced.effects).toEqual([{ type: "render-mermaid", attempt: 2, input: "flowchart TD\nX --> Y" }])
    expect(svg(replaced.state)).toBe("<svg>1</svg>")
  })

  test("shows the empty diagram box until the first line ends, then renders whole lines once", () => {
    const first = run([sync("flowchart LR", false)])

    expect(viewCodeDecoration(first.state).pending).toBe(true)
    expect(first.effects).toEqual([])
    const line = transitionCodeDecoration(first.state, sync("flowchart LR\nA", false))
    const token = transitionCodeDecoration(line.state, sync("flowchart LR\nA -", false))

    expect(line.effects).toEqual([{ type: "render-mermaid", attempt: 1, input: "flowchart LR\n" }])
    expect(token.state).toBe(line.state)
  })

  test("shows the code when a streamed diagram fails, and renders the next lines behind it", () => {
    const failed = run([sync("invalid\n", false), { type: "mermaid.failed", attempt: 1 }])

    expect(failed.state.status).toBe("code")
    expect(viewCodeDecoration(failed.state).pending).toBe(false)
    expect(transitionCodeDecoration(failed.state, sync("invalid\nmore", false)).state).toBe(failed.state)
    const retry = transitionCodeDecoration(failed.state, sync("invalid\nflowchart LR\n", false))

    expect(retry.state.status).toBe("code")
    expect(retry.effects).toEqual([{ type: "render-mermaid", attempt: 2, input: "invalid\nflowchart LR\n" }])
    const recovered = transitionCodeDecoration(retry.state, { type: "mermaid.resolved", attempt: 2, svg: "<svg />" })

    expect(svg(recovered.state)).toBe("<svg />")
  })

  test("treats a render without output like a failure", () => {
    const declined = run([sync("not a diagram", true), { type: "mermaid.resolved", attempt: 1, svg: undefined }])

    expect(declined.state.status).toBe("code")
    expect(transitionCodeDecoration(declined.state, sync("not a diagram", true)).state).toBe(declined.state)
  })

  test("keeps the last diagram while newer lines fail, and shows the code when the complete diagram fails", () => {
    const ready = run([sync("flowchart LR\n", false), { type: "mermaid.resolved", attempt: 1, svg: "<svg>1</svg>" }])
    const refreshing = transitionCodeDecoration(ready.state, sync("flowchart LR\nA[\n", false))

    expect(viewCodeDecoration(refreshing.state)).toMatchObject({ pending: false, svg: "<svg>1</svg>" })
    const kept = transitionCodeDecoration(refreshing.state, { type: "mermaid.failed", attempt: 2 })

    expect(svg(kept.state)).toBe("<svg>1</svg>")
    const complete = run([sync("flowchart LR\nA[", true), { type: "mermaid.failed", attempt: 3 }], kept.state)

    expect(complete.state.status).toBe("code")
    expect(viewCodeDecoration(complete.state).diagram).toBe(false)
  })

  test("ignores a Mermaid render that finishes after a plugin claimed the block", () => {
    const match = claim("mermaid")
    const pending = run([sync("flowchart LR\nA --> B\n", false)])

    const plugin = transitionCodeDecoration(pending.state, {
      type: "sync",
      language: "mermaid",
      source: "flowchart LR\nA --> B\n",
      complete: true,
      match,
    })

    expect(plugin.effects).toEqual([
      { type: "mount-plugin", attempt: 2, block: { code: "flowchart LR\nA --> B", language: "mermaid" } },
    ])
    const late = transitionCodeDecoration(plugin.state, { type: "mermaid.resolved", attempt: 1, svg: "<svg />" })

    expect(late.state).toBe(plugin.state)
    expect(viewCodeDecoration(plugin.state)).toMatchObject({ content: true, svg: undefined })
    const fallback = transitionCodeDecoration(plugin.state, { type: "plugin.failed", attempt: 2 })

    expect(fallback.state.status).toBe("diagram-pending")
    expect(fallback.effects).toEqual([
      { type: "clear-plugin" },
      { type: "render-mermaid", attempt: 3, input: "flowchart LR\nA --> B\n" },
    ])
  })

  test("keeps the code after plugin content fails until the block changes", () => {
    const match = claim("chart")
    const event = { type: "sync", language: "chart", source: "x", complete: true, match } as const
    const mounted = transitionCodeDecoration(INITIAL_CODE_DECORATION_STATE, event)
    const failed = transitionCodeDecoration(mounted.state, { type: "plugin.failed", attempt: 1 })
    const stale = transitionCodeDecoration(failed.state, { type: "plugin.failed", attempt: 1 })

    expect(failed.state.status).toBe("code")
    expect(stale.state).toBe(failed.state)
    expect(transitionCodeDecoration(failed.state, event).state).toBe(failed.state)
    expect(transitionCodeDecoration(failed.state, { ...event, source: "y" }).effects).toEqual([
      { type: "mount-plugin", attempt: 2, block: { code: "y", language: "chart" } },
    ])
  })

  test("waits for the closing fence before mounting claimed content", () => {
    const match = claim("chart")

    const streaming = transitionCodeDecoration(INITIAL_CODE_DECORATION_STATE, {
      type: "sync",
      language: "chart",
      source: "x",
      complete: false,
      match,
    })

    expect(streaming.state).toBe(INITIAL_CODE_DECORATION_STATE)
  })

  test("mounts actions for a complete block and moves them when it changes", () => {
    const match = { render: new Set<string>(), actions: new Set(["sql"]) }
    const event = { type: "sync", language: "sql", source: "select 1\n", complete: true, match } as const
    const mounted = transitionCodeDecoration(INITIAL_CODE_DECORATION_STATE, event)

    expect(mounted.effects).toEqual([{ type: "mount-actions", block: { code: "select 1", language: "sql" } }])
    expect(transitionCodeDecoration(mounted.state, event).state).toBe(mounted.state)
    expect(transitionCodeDecoration(mounted.state, { ...event, match: undefined }).effects).toEqual([
      { type: "clear-actions" },
    ])
  })

  test("clears mounted content on dispose and ignores results that arrive later", () => {
    const match = { render: new Set(["chart"]), actions: new Set(["chart"]) }

    const mounted = transitionCodeDecoration(INITIAL_CODE_DECORATION_STATE, {
      type: "sync",
      language: "chart",
      source: "x",
      complete: true,
      match,
    })

    const disposed = transitionCodeDecoration(mounted.state, { type: "disposed" })

    expect(disposed.effects).toEqual([{ type: "clear-actions" }, { type: "clear-plugin" }])
    expect(transitionCodeDecoration(disposed.state, { type: "plugin.failed", attempt: 1 }).state).toBe(disposed.state)
    const pending = run([sync("flowchart LR\n", false), { type: "disposed" }])

    expect(viewCodeDecoration(pending.state).diagram).toBe(false)
    expect(
      transitionCodeDecoration(pending.state, { type: "mermaid.resolved", attempt: 1, svg: "<svg />" }).state,
    ).toBe(pending.state)
  })

  test("leaves the diagram when the block stops being Mermaid", () => {
    const pending = run([sync("flowchart LR\n", false)])
    const code = transitionCodeDecoration(pending.state, sync("flowchart LR\n", false, "text"))

    expect(code.state.status).toBe("code")
    expect(transitionCodeDecoration(code.state, { type: "mermaid.resolved", attempt: 1, svg: "<svg />" }).state).toBe(
      code.state,
    )
  })
})
