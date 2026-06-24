import { describe, it, expect } from "bun:test"
import { RawAdapter } from "@/terminal/input/RawAdapter"

describe("RawAdapter", () => {
  it("isActive is false by default", () => {
    const ra = new RawAdapter()
    expect(ra.isActive).toBe(false)
  })

  it("restore is safe when not enabled", () => {
    const ra = new RawAdapter()
    expect(() => ra.restore()).not.toThrow()
  })

  it("isActive remains false when enable throws", () => {
    const prev = process.stdin.isTTY
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true })
    try {
      const ra = new RawAdapter()
      try { ra.enable() } catch {}
      expect(ra.isActive).toBe(false)
    } finally {
      Object.defineProperty(process.stdin, "isTTY", { value: prev, configurable: true })
    }
  })

  it("enable throws when stdin not a TTY", () => {
    const prev = process.stdin.isTTY
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true })
    try {
      const ra = new RawAdapter()
      expect(() => ra.enable()).toThrow("not a TTY")
    } finally {
      Object.defineProperty(process.stdin, "isTTY", { value: prev, configurable: true })
    }
  })
})
