import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { useVisualization } from "../context/visualization"
import {
  displayVisualizationHeight,
  filterVisualizationMessage,
  resolveVisualizationFrameHeight,
} from "./visualization-frame"
import { visualizationStructured, visualizationToolState } from "./visualization-tool"
import { COLLAPSED_HEIGHT, MAX_HEIGHT, MIN_HEIGHT } from "./visualization-schema"

describe("Visualization context", () => {
  test("disables visualizations and rejects follow-ups without an App provider", async () => {
    const result = createRoot(() => useVisualization())

    expect(result.enabled).toBe(false)
    await expect(result.followUp({ sessionID: "session-1", prompt: "Use compact layout" })).resolves.toBe("rejected")
  })
})

describe("Visualization tool renderer state", () => {
  test("uses a compact thinking state until a completed result is available", () => {
    expect(visualizationToolState("pending")).toEqual({ type: "thinking" })
    expect(visualizationToolState("running")).toEqual({ type: "thinking" })
  })

  test("requires an explicit desktop capability before rendering a decoded completed structured result", () => {
    const value = { version: 1 as const, title: "Controls", html: "<button>Use</button>" }

    expect(visualizationToolState("completed", value)).toEqual({ type: "invalid" })
    expect(visualizationToolState("completed", value, true)).toEqual({ type: "frame", value })
    expect(visualizationToolState("completed", { version: 1, title: "Controls", html: "" }, true)).toEqual({
      type: "invalid",
    })
  })

  test("uses legacy v1 metadata only when structured output is absent", () => {
    const legacy = { version: 1 as const, title: "Clock", html: "<div>clock</div>" }

    expect(visualizationStructured(undefined, legacy)).toEqual(legacy)
    expect(visualizationStructured({ version: 1, title: "Current", html: "<div>current</div>" }, legacy)).toEqual({
      version: 1,
      title: "Current",
      html: "<div>current</div>",
    })
    expect(visualizationStructured(null, legacy)).toBeNull()
  })
})

describe("Visualization frame host protocol", () => {
  test("accepts only the current iframe source, token, and generation", () => {
    const frameWindow = {} as WindowProxy
    const input = {
      frameWindow,
      token: "current-token",
      generation: 2,
      currentGeneration: 2,
      data: { version: 1, type: "ready", token: "current-token" } as const,
    }

    expect(filterVisualizationMessage({ ...input, source: {} as MessageEventSource })).toBeUndefined()
    expect(
      filterVisualizationMessage({ ...input, source: frameWindow, data: { ...input.data, token: "old-token" } }),
    ).toBeUndefined()
    expect(filterVisualizationMessage({ ...input, source: frameWindow, generation: 1 })).toBeUndefined()
    expect(filterVisualizationMessage({ ...input, source: frameWindow })).toEqual(input.data)
  })

  test("clamps received and displayed heights without exceeding collapse or maximum limits", () => {
    expect(resolveVisualizationFrameHeight(1)).toBe(MIN_HEIGHT)
    expect(resolveVisualizationFrameHeight(MAX_HEIGHT + 1)).toBe(MAX_HEIGHT)
    expect(displayVisualizationHeight(MAX_HEIGHT, false)).toBe(COLLAPSED_HEIGHT)
    expect(displayVisualizationHeight(MAX_HEIGHT, true)).toBe(MAX_HEIGHT)
  })
})
