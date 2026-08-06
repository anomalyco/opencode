// Selecting a mode can start or stop an hours-long backlog run, so this logic
// decides whether real work begins or is thrown away. It is pure on purpose.
import { describe, expect, test } from "bun:test"
import type { Loop } from "@opencode-ai/sdk/v2"
import { currentAutoMode, liveQueueRuns, modeSpec, reconcileQueue } from "../src/util/auto-mode"

function loop(input: Partial<Loop> & Pick<Loop, "id">): Loop {
  return {
    directory: "/repo",
    sessionID: "ses_1",
    prompt: "",
    status: input.status ?? "running",
    maxIterations: 50,
    noProgressLimit: 3,
    completionToken: "<promise>COMPLETE</promise>",
    iteration: 0,
    iterations: [],
    startedAt: 0,
    mode: input.mode ?? "queue",
    ...input,
  } as Loop
}

function harness(existing: Loop[]) {
  const cancelled: string[] = []
  let started = 0
  return {
    cancelled,
    get started() {
      return started
    },
    calls: {
      list: async () => existing,
      start: async () => {
        started++
        return loop({ id: "loop_new" })
      },
      cancel: async (id: string) => {
        cancelled.push(id)
      },
    },
  }
}

describe("liveQueueRuns", () => {
  test("only queue runs that are still going count", () => {
    const all = [
      loop({ id: "a", status: "running" }),
      loop({ id: "b", status: "paused" }),
      loop({ id: "c", status: "completed" }),
      loop({ id: "d", status: "error" }),
      loop({ id: "e", status: "running", mode: "prompt" }),
    ]
    expect(liveQueueRuns(all).map((x) => x.id)).toEqual(["a", "b"])
  })
})

describe("reconcileQueue", () => {
  test("Auto starts a backlog run when none is going", async () => {
    const h = harness([])
    const result = await reconcileQueue({ mode: "auto", ...h.calls })
    expect(h.started).toBe(1)
    expect(result.started?.id).toBe("loop_new")
    expect(h.cancelled).toEqual([])
  })

  test("Auto selected twice does not stack a second run on the same tree", async () => {
    const h = harness([loop({ id: "loop_existing" })])
    const result = await reconcileQueue({ mode: "auto", ...h.calls })
    expect(h.started).toBe(0)
    expect(result.started).toBeUndefined()
  })

  test("leaving Auto stops the run, so the indicator cannot lie", async () => {
    for (const mode of ["manual", "skip-ask", "continue"] as const) {
      const h = harness([loop({ id: "loop_a" }), loop({ id: "loop_b", status: "paused" })])
      const result = await reconcileQueue({ mode, ...h.calls })
      expect(h.cancelled).toEqual(["loop_a", "loop_b"])
      expect(result.stopped).toBe(2)
      expect(h.started).toBe(0)
    }
  })

  test("a non-Auto mode with nothing running is a no-op", async () => {
    const h = harness([loop({ id: "done", status: "completed" })])
    const result = await reconcileQueue({ mode: "manual", ...h.calls })
    expect(h.cancelled).toEqual([])
    expect(result.stopped).toBe(0)
  })

  test("only Auto drives the backlog", () => {
    expect(modeSpec("auto").auto_queue).toBe(true)
    for (const mode of ["manual", "skip-ask", "continue"] as const) {
      expect(modeSpec(mode).auto_queue).toBe(false)
    }
  })

  test("the mode a config maps to round-trips through its spec", () => {
    for (const mode of ["manual", "skip-ask", "continue", "auto"] as const) {
      const spec = modeSpec(mode)
      expect(currentAutoMode(spec.auto_mode, spec.auto_continue, spec.auto_queue)).toBe(mode)
    }
  })
})
