import { describe, expect, test } from "bun:test"
import {
  ACTION_BYTES,
  peakWorkingSetBytes,
  pressureLevel,
  WARNING_BYTES,
} from "./memory-threshold"

const KB = 1024

describe("memory peak working set", () => {
  test("returns zero for an empty metrics list", () => {
    expect(peakWorkingSetBytes([])).toBe(0)
  })

  test("converts the largest working set from kilobytes to bytes", () => {
    const metrics = [
      { pid: 1, type: "Browser", memory: { workingSetSize: 100 * KB } },
      { pid: 2, type: "Utility", memory: { workingSetSize: 300 * KB } },
      { pid: 3, type: "Renderer", memory: { workingSetSize: 200 * KB } },
    ]
    expect(peakWorkingSetBytes(metrics)).toBe(300 * KB * 1024)
  })
})

describe("memory pressure level", () => {
  test("is ok below the warning threshold", () => {
    expect(pressureLevel(WARNING_BYTES - 1)).toBe("ok")
  })

  test("is warning at and above the warning threshold", () => {
    expect(pressureLevel(WARNING_BYTES)).toBe("warning")
    expect(pressureLevel(ACTION_BYTES - 1)).toBe("warning")
  })

  test("is action at and above the action threshold", () => {
    expect(pressureLevel(ACTION_BYTES)).toBe("action")
    expect(pressureLevel(ACTION_BYTES + 1)).toBe("action")
  })

  test("keeps the action threshold below the 2GB default process limit", () => {
    expect(ACTION_BYTES).toBeLessThan(2 * 1024 ** 3)
    expect(WARNING_BYTES).toBeLessThan(ACTION_BYTES)
  })
})
