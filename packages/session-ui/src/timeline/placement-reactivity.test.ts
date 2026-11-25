import { describe, expect, test } from "bun:test"
import type { SessionMessageInfo } from "@opencode/client/promise"
import { createRoot, createSignal } from "solid-js"
import { isServer } from "solid-js/web"
import { storyTool } from "../storybook/current-session-scenarios"
import { timelinePresets } from "./detail"
import { createReactiveTimelineProjection, placeFacts } from "./projection"
import { projectionRuns } from "./placement-reactivity"

const detail = timelinePresets.find((item) => item.id === "detailed")!.value

// Solid's server build does not track, so this runs with `bun test --conditions=browser`.
describe.skipIf(isServer)("current timeline placement reactivity", () => {
  test("does not rebuild its rows while calls stream or report progress", () => {
    const runs = projectionRuns(
      (messages, status) =>
        createReactiveTimelineProjection({
          sessionMessages: messages,
          status,
          reasoningMode: () => "full",
          timelineDetail: () => detail,
        }).rows,
    )

    expect(runs).toEqual({ streamed: 0, moved: 1, changed: [1, 1], scripted: 1 })
  })

  // A history page shifts every message's index; the messages already loaded did not change.
  test("reads only the messages of a history page that lands", () => {
    createRoot((dispose) => {
      const reads: Record<string, number> = {}

      const message = (id: string): SessionMessageInfo => {
        const content = [storyTool(id, "shell", "running", { command: "make" }, { metadata: { output: "a" } })]

        return {
          id,
          type: "assistant",
          agent: "build",
          model: { id: "model", providerID: "provider" },
          time: { created: 1 },
          get content() {
            reads[id] = (reads[id] ?? 0) + 1

            return content
          },
        }
      }

      const [messages, setMessages] = createSignal([message("later"), message("latest")])
      placeFacts(messages)
      const before = { ...reads }
      setMessages((loaded) => [message("older"), ...loaded])
      expect(reads).toEqual({ ...before, older: 1 })
      dispose()
    })
  })
})
