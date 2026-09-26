import { RGBA } from "@opentui/core"
import { describe, expect, test } from "bun:test"
import { reasoningHeaderColor, reasoningSummary } from "../../../src/context/thinking"

describe("reasoningSummary", () => {
  test("extracts a leading summary title and leaves markdown body", () => {
    expect(reasoningSummary("**Continuing Quality Review**\n\nDetails.\n\n**Next section**\n\nMore.")).toEqual({
      title: "Continuing Quality Review",
      body: "Details.\n\n**Next section**\n\nMore.",
    })
  })

  test("extracts a completed title before its streamed body arrives", () => {
    expect(reasoningSummary("**Continuing Quality Review**")).toEqual({
      title: "Continuing Quality Review",
      body: "",
    })
  })

  test("preserves markdown-significant indentation in the extracted body", () => {
    expect(reasoningSummary("**Continuing Quality Review**\n\n    const value = true\n")).toEqual({
      title: "Continuing Quality Review",
      body: "    const value = true",
    })
  })

  test("does not consume ordinary leading bold content", () => {
    expect(reasoningSummary("**Important:** keep this in the body.")).toEqual({
      title: null,
      body: "**Important:** keep this in the body.",
    })
  })

  test("leaves content without a leading title in its body", () => {
    expect(reasoningSummary("Details only.")).toEqual({ title: null, body: "Details only." })
  })
})

describe("reasoningHeaderColor", () => {
  const warning = RGBA.fromValues(1, 0.4, 0, 1)

  test("dims a collapsed completed title with theme thinkingOpacity", () => {
    const color = reasoningHeaderColor({
      done: true,
      open: false,
      hover: false,
      warning,
      thinkingOpacity: 0.4,
    })
    expect(color.r).toBe(warning.r)
    expect(color.g).toBe(warning.g)
    expect(color.b).toBe(warning.b)
    expect(color.a).toBe(0.4)

    const solid = reasoningHeaderColor({
      done: true,
      open: false,
      hover: false,
      warning,
      thinkingOpacity: 1,
    })
    expect(solid.a).toBe(1)
  })

  test("keeps the full warning color while expanded, hovered, or still streaming", () => {
    const expanded = reasoningHeaderColor({
      done: true,
      open: true,
      hover: false,
      warning,
      thinkingOpacity: 0.25,
    })
    const hovered = reasoningHeaderColor({
      done: true,
      open: false,
      hover: true,
      warning,
      thinkingOpacity: 0.25,
    })
    const streaming = reasoningHeaderColor({
      done: false,
      open: false,
      hover: false,
      warning,
      thinkingOpacity: 0.25,
    })
    expect(expanded).toBe(warning)
    expect(hovered).toBe(warning)
    expect(streaming).toBe(warning)
  })
})
