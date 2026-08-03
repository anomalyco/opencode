import { describe, expect, test } from "bun:test"
import { preserveMarketplaceScroll } from "./marketplace-scroll"

describe("Marketplace scroll preservation", () => {
  test("restores the current scroll container after a mutation", async () => {
    const frames: Array<() => void> = []
    const original = { scrollTop: 180 }
    let current = original

    const result = await preserveMarketplaceScroll(
      () => current,
      async () => {
        current = { scrollTop: 0 }
        return "updated"
      },
      (callback) => frames.push(callback),
    )

    expect(result).toBe("updated")
    expect(current.scrollTop).toBe(0)
    frames[0]?.()
    expect(current.scrollTop).toBe(180)
  })

  test("restores scroll after a failed mutation", async () => {
    const frames: Array<() => void> = []
    const current = { scrollTop: 96 }

    await expect(
      preserveMarketplaceScroll(
        () => current,
        async () => {
          current.scrollTop = 0
          throw new Error("failed")
        },
        (callback) => frames.push(callback),
      ),
    ).rejects.toThrow("failed")

    frames[0]?.()
    expect(current.scrollTop).toBe(96)
  })
})
