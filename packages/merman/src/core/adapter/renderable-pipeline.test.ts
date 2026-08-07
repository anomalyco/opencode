import { describe, expect, test } from "bun:test"
import { DiagramRenderablePipeline } from "./renderable-pipeline.js"

describe("DiagramRenderablePipeline", () => {
  test("caches the parsed diagram and grid across style repaints", () => {
    let parseCount = 0
    let drawCount = 0
    let publishCount = 0
    const pipeline = new DiagramRenderablePipeline({
      parse: () => ({ version: ++parseCount }),
      draw: (diagram) => ({ version: diagram.version, draw: ++drawCount }),
      publish: () => {
        publishCount += 1
      },
    })

    pipeline.invalidateParsedDiagram()
    pipeline.invalidateStyle()
    pipeline.invalidateGrid()

    expect({ parseCount, drawCount, publishCount }).toEqual({ parseCount: 1, drawCount: 2, publishCount: 3 })
  })

  test("reparses source changes and coalesces nested invalidations", () => {
    const events: string[] = []
    const pipeline = new DiagramRenderablePipeline({
      parse: () => {
        events.push("parse")
        return {}
      },
      draw: (diagram) => {
        events.push("draw")
        return diagram
      },
      publish: () => events.push("publish"),
    })

    pipeline.invalidateParsedDiagram()
    events.length = 0
    pipeline.batchUpdate(() => {
      pipeline.invalidateStyle()
      pipeline.batchUpdate(() => pipeline.invalidateGrid())
      pipeline.invalidateParsedDiagram()
    })

    expect(events).toEqual(["parse", "draw", "publish"])
  })
})
