import { describe, expect, test } from "bun:test"
import { parseVisual } from "./spec"

const plot = JSON.stringify({
  v: 1,
  kind: "plot",
  title: "Stress amplitude against cycles",
  unit: "MPa",
  data: {
    x: { label: "cycles" },
    y: { label: "stress" },
    series: [{ label: "S275", points: [[1000, 420], [10000, 330]] }],
  },
})

describe("parseVisual", () => {
  test("accepts a complete plot spec", () => {
    const result = parseVisual(plot)
    expect(result.ok).toBe(true)

    if (!result.ok) return
    expect(result.spec.kind).toBe("plot")
    expect(result.spec.unit).toBe("MPa")
    expect(result.spec.v).toBe(1)
  })

  test("rejects a block without a title", () => {
    const result = parseVisual(JSON.stringify({ v: 1, kind: "plot", data: {} }))
    expect(result.ok).toBe(false)

    if (result.ok) return
    expect(result.error).toContain("title")
  })

  test("requires spec version 1", () => {
    const missing = parseVisual(JSON.stringify({ kind: "plot", title: "No version" }))
    expect(missing.ok).toBe(false)
    const future = parseVisual(JSON.stringify({ v: 2, kind: "plot", title: "Future" }))
    expect(future.ok).toBe(false)
    const zero = parseVisual(JSON.stringify({ v: 0, kind: "plot", title: "Zero" }))
    expect(zero.ok).toBe(false)
  })

  test("rejects an unknown kind", () => {
    const result = parseVisual(JSON.stringify({ v: 1, kind: "spaceship", title: "No" }))
    expect(result.ok).toBe(false)

    if (result.ok) return
    expect(result.error).toContain("Unknown kind")
  })

  test("rejects invalid JSON", () => {
    const result = parseVisual("{ nope }")
    expect(result.ok).toBe(false)
  })

  test("rejects a non-object root", () => {
    const result = parseVisual("[]")
    expect(result.ok).toBe(false)
  })

  test("trims long titles and keeps optional fields", () => {
    const result = parseVisual(
      JSON.stringify({
        v: 1,
        kind: "plot",
        title: "x".repeat(400),
        caption: "Keep me",
        note: "Idealized",
        source: "Plan",
        height: 9000,
        data: {},
      }),
    )

    expect(result.ok).toBe(true)

    if (!result.ok) return
    expect(result.spec.title.length).toBe(160)
    expect(result.spec.caption).toBe("Keep me")
    expect(result.spec.note).toBe("Idealized")
    expect(result.spec.source).toBe("Plan")
    expect(result.spec.height).toBe(720)
  })

  test("caps oversized input", () => {
    const result = parseVisual(`{"v":1,"kind":"plot","title":"x","data":{"a":"${"x".repeat(300_000)}"}}`)
    expect(result.ok).toBe(false)

    if (result.ok) return
    expect(result.error).toContain("larger than")
  })

  test("allows a visual without data", () => {
    const result = parseVisual(JSON.stringify({ v: 1, kind: "plot", title: "Working" }))
    expect(result.ok).toBe(true)

    if (!result.ok) return
    expect(result.spec.data).toEqual({})
  })
})
