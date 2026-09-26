import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { useToolElapsed } from "../../../src/routes/session/tool-elapsed"
import type { ToolPart } from "@opencode-ai/sdk/v2"

function part(status: "pending" | "running" | "completed" | "error"): ToolPart {
  const base = {
    id: "prt_1",
    sessionID: "ses_1",
    messageID: "msg_1",
    type: "tool" as const,
    callID: "call_1",
    tool: "bash",
  }
  if (status === "completed") {
    return {
      ...base,
      state: { status, input: {}, output: "ok", title: "ls", metadata: {}, time: { start: 1000, end: 4200 } },
    }
  }
  if (status === "error") {
    return { ...base, state: { status, input: {}, error: "boom", time: { start: 1000, end: 2500 } } }
  }
  if (status === "running") {
    return { ...base, state: { status, input: {}, time: { start: Date.now() - 100 } } }
  }
  return { ...base, state: { status, input: {}, raw: "{}" } }
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe("useToolElapsed", () => {
  test("empty while pending without timestamps", async () => {
    await new Promise<void>((resolve) =>
      createRoot((dispose) => {
        const elapsed = useToolElapsed(() => part("pending"))
        void flush().then(() => {
          expect(elapsed()).toBe("")
          dispose()
          resolve()
        })
      }),
    )
  })

  test("frozen total once completed, timer never starts", async () => {
    await new Promise<void>((resolve) =>
      createRoot((dispose) => {
        const elapsed = useToolElapsed(() => part("completed"))
        void flush().then(() => {
          expect(elapsed()).toBe("· 3.2s")
          dispose()
          resolve()
        })
      }),
    )
  })

  test("live text while running, frozen text on error", async () => {
    await new Promise<void>((resolve) =>
      createRoot((dispose) => {
        const elapsed = useToolElapsed(() => part("running"))
        void flush().then(() => {
          expect(elapsed().startsWith("· ")).toBe(true)
          dispose()
          resolve()
        })
      }),
    )
    await new Promise<void>((resolve) =>
      createRoot((dispose) => {
        const elapsed = useToolElapsed(() => part("error"))
        void flush().then(() => {
          expect(elapsed()).toBe("· 1.5s")
          dispose()
          resolve()
        })
      }),
    )
  })
})
