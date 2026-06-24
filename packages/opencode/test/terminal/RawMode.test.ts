import { describe, it, expect } from "bun:test"
import { RawMode } from "@/terminal/input/RawMode"

describe("RawMode", () => {
  it("throws when stdin is not a TTY", () => {
    const prev = process.stdin.isTTY
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true })
    try {
      const rm = new RawMode()
      expect(() => rm.enable()).toThrow("not a TTY")
    } finally {
      Object.defineProperty(process.stdin, "isTTY", { value: prev, configurable: true })
    }
  })

  it("restore is safe when not enabled", () => {
    const rm = new RawMode()
    expect(() => rm.restore()).not.toThrow()
  })
})
