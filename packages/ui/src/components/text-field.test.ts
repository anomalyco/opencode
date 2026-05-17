import { afterEach, describe, expect, test } from "bun:test"
import { copyText } from "./text-field-copy"

const originalNavigator = globalThis.navigator
const originalDocument = globalThis.document

afterEach(() => {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: originalNavigator,
  })
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: originalDocument,
  })
})

describe("text-field", () => {
  test("uses navigator clipboard when available", async () => {
    const writes: string[] = []
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        clipboard: {
          writeText: async (value: string) => {
            writes.push(value)
          },
        },
      },
    })

    expect(await copyText("hello")).toBe(true)
    expect(writes).toEqual(["hello"])
  })

  test("falls back to execCommand when navigator clipboard fails", async () => {
    const appended: Array<{ value: string; select: () => void }> = []
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        clipboard: {
          writeText: async () => {
            throw new Error("blocked")
          },
        },
      },
    })
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        body: {
          appendChild: (node: { value: string; select: () => void }) => appended.push(node),
          removeChild: () => {},
        },
        createElement: () => ({
          value: "",
          style: {},
          setAttribute: () => {},
          select: () => {},
        }),
        execCommand: (command: string) => command === "copy",
      },
    })

    expect(await copyText("fallback")).toBe(true)
    expect(appended.map((node) => node.value)).toEqual(["fallback"])
  })
})
