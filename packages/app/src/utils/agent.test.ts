import { afterEach, describe, expect, test } from "bun:test"
import { agentColor } from "./agent"

const originalCss = globalThis.CSS

describe("agentColor", () => {
  afterEach(() => {
    Object.defineProperty(globalThis, "CSS", {
      value: originalCss,
      configurable: true,
      writable: true,
    })
  })

  test("maps theme tokens to app theme colors", () => {
    expect(agentColor("custom", "primary")).toBe("var(--syntax-info)")
    expect(agentColor("custom", "secondary")).toBe("var(--syntax-property)")
    expect(agentColor("custom", "error")).toBe("var(--text-diff-delete-base)")
  })

  test("keeps supported css colors", () => {
    Object.defineProperty(globalThis, "CSS", {
      value: {
        supports: (property: string, value: string) => property === "color" && value === "rebeccapurple",
      },
      configurable: true,
      writable: true,
    })

    expect(agentColor("custom", "rebeccapurple")).toBe("rebeccapurple")
  })

  test("falls back to automatic palette for unsupported colors", () => {
    Object.defineProperty(globalThis, "CSS", {
      value: {
        supports: () => false,
      },
      configurable: true,
      writable: true,
    })

    expect(agentColor("custom", "not-a-real-color")).toBe("var(--icon-agent-build-base)")
  })
})
