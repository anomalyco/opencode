import { describe, expect, test } from "bun:test"
import { flattenedFooter } from "../../src/ui/dialog-select"

describe("ui.dialog-select.flattenedFooter", () => {
  test("regression: a flattened, filtered row keeps its size and shows provenance", () => {
    // This is the exact reported defect: `footer={flatten() ? (option.category
    // ?? option.footer) : option.footer}` replaced the GB size with the
    // provider name the moment a filter was typed.
    const result = flattenedFooter({
      title: "Qwen3.6 35B A3B",
      value: undefined,
      footer: "20.3 GB",
      provenance: "z4",
    })
    expect(result).toBe("20.3 GB · z4")
  })

  test("falls back to category when provenance is not set", () => {
    const result = flattenedFooter({
      title: "model",
      value: undefined,
      footer: "9.2 GB",
      category: "proxmox",
    })
    expect(result).toBe("9.2 GB · proxmox")
  })

  test("shows provenance alone when there is no footer", () => {
    const result = flattenedFooter({
      title: "model",
      value: undefined,
      provenance: "rocky",
    })
    expect(result).toBe("rocky")
  })

  test("shows footer alone when there is no provenance or category", () => {
    const result = flattenedFooter({
      title: "model",
      value: undefined,
      footer: "Free",
    })
    expect(result).toBe("Free")
  })

  test("a non-string footer falls back to the previous behavior (can't concatenate JSX)", () => {
    const jsxFooter = { type: "text" } as unknown as string
    const result = flattenedFooter({
      title: "model",
      value: undefined,
      footer: jsxFooter,
      provenance: "z4",
    })
    expect(result).toBe(jsxFooter)
  })
})
