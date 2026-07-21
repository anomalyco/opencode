import { describe, expect, test } from "bun:test"
import {
  capabilityLine,
  capabilityLineSegments,
  isVisionCapable,
  parse,
  type ModelShape,
} from "../../src/util/model"

describe("util.model", () => {
  test("splits provider from a nested model identifier", () => {
    expect(parse("provider/org/model")).toEqual({ providerID: "provider", modelID: "org/model" })
    expect(parse("invalid")).toEqual({ providerID: "invalid", modelID: "" })
  })
})

function shape(partial: {
  attachment?: boolean
  image?: boolean
  pdf?: boolean
  variants?: Record<string, unknown>
}): ModelShape {
  return {
    id: "m",
    name: "M",
    status: "active",
    capabilities: {
      attachment: partial.attachment ?? false,
      reasoning: false,
      toolcall: true,
      temperature: true,
      input: {
        text: true,
        image: partial.image ?? false,
        audio: false,
        video: false,
        pdf: partial.pdf ?? false,
      },
      output: { text: true, image: false, audio: false, video: false, pdf: false },
    },
    variants: partial.variants,
  } as ModelShape
}

describe("isVisionCapable", () => {
  test("requires input.image or input.pdf, not attachment alone", () => {
    expect(isVisionCapable(shape({ attachment: true }))).toBe(false)
    expect(isVisionCapable(shape({ image: true }))).toBe(true)
    expect(isVisionCapable(shape({ pdf: true }))).toBe(true)
  })
})

describe("capabilityLine", () => {
  const fallback = { providerID: "p", modelID: "v" }

  test("appends fallback-vision before variants for text-only models", () => {
    expect(capabilityLine(shape({ variants: { a: {} } }), fallback)).toBe(
      "tools · fallback-vision · +1 variant",
    )
  })

  test("does not append fallback-vision for vision-capable models", () => {
    expect(capabilityLine(shape({ image: true }), fallback)).toBe("tools · vision")
  })

  test("legacy attachment chip can coexist with fallback-vision", () => {
    // Catalog `vision` still includes `attachment`; fallback gating uses image/pdf only.
    expect(capabilityLine(shape({ attachment: true }), fallback)).toBe(
      "tools · vision · fallback-vision",
    )
  })

  test("omits fallback-vision when effective fallback is unset (opt-out)", () => {
    expect(capabilityLine(shape({}), undefined)).toBe("tools")
    expect(capabilityLine(shape({}), null)).toBe("tools")
  })

  test("segments mark per-model override as info and inherited as muted", () => {
    const model = shape({})
    const perModel = capabilityLineSegments(model, fallback, fallback, fallback)
    const inherited = capabilityLineSegments(model, fallback, fallback, undefined)
    expect(perModel.find((s) => s.text === "fallback-vision")?.colorHint).toBe("info")
    expect(inherited.find((s) => s.text === "fallback-vision")?.colorHint).toBe("muted")
  })

  test("segments omit fallback-vision for null opt-out when no effective fallback", () => {
    const segs = capabilityLineSegments(shape({}), undefined, fallback, null)
    expect(segs.some((s) => s.text === "fallback-vision")).toBe(false)
  })
})
