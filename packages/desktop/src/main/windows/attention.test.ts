import { afterEach, describe, expect, test } from "bun:test"
import { flashInfo, requestAttention } from "./attention"

const originalPlatform = process.platform

afterEach(() => {
  Object.defineProperty(process, "platform", { value: originalPlatform })
})

describe("flashInfo", () => {
  test("lays out FLASHWINFO for 64-bit Windows: two tray flashes, then lit until the window comes forward", () => {
    const hwnd = Buffer.from([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0])
    const info = flashInfo(hwnd)

    expect(info.length).toBe(32)
    expect(info.readUInt32LE(0)).toBe(32)
    expect(info.subarray(8, 16)).toEqual(hwnd)
    expect(info.readUInt32LE(16)).toBe(2)
    expect(info.readUInt32LE(20)).toBe(2)
    expect(info.readUInt32LE(24)).toBe(0)
  })
})

describe("requestAttention", () => {
  test.each<{ name: string; platform: NodeJS.Platform; focused: boolean; destroyed: boolean }>([
    { name: "macOS", platform: "darwin", focused: false, destroyed: false },
    { name: "Linux", platform: "linux", focused: false, destroyed: false },
    { name: "a focused Windows window", platform: "win32", focused: true, destroyed: false },
    { name: "a destroyed Windows window", platform: "win32", focused: false, destroyed: true },
  ])("never reads the native handle for $name", async ({ platform, focused, destroyed }) => {
    Object.defineProperty(process, "platform", { value: platform })
    const reads: string[] = []

    await requestAttention({
      isDestroyed: () => destroyed,
      isFocused: () => focused,
      getNativeWindowHandle: () => {
        reads.push("handle")

        return Buffer.alloc(8)
      },
    })

    expect(reads).toEqual([])
  })
})
