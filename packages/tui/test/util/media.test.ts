import { describe, expect, test } from "bun:test"
import { createMediaCache } from "../../src/util/media"

const hash = "d".repeat(64)

function setup(get: (input: { hash: string }) => Promise<Uint8Array>) {
  const calls: string[] = []
  const cache = createMediaCache(() => ({
    experimental: {
      media: {
        get: (input: { hash: string }) => {
          calls.push(input.hash)
          return get(input)
        },
      },
    },
  }))
  return { cache, calls }
}

describe("media cache", () => {
  test("reads each hash once, sharing a request in flight", async () => {
    const bytes = new Uint8Array([1, 2, 3])
    const { cache, calls } = setup(async () => bytes)

    expect(cache.peek(`media:${hash}`)).toBeUndefined()
    const [first, second] = await Promise.all([cache.read(`media:${hash}`), cache.read(`media:${hash}`)])

    expect(first).toBe(bytes)
    expect(second).toBe(bytes)
    expect(await cache.read(`media:${hash}`)).toBe(bytes)
    expect(cache.peek(`media:${hash}`)).toBe(bytes)
    expect(calls).toEqual([hash])
  })

  test("retries a hash whose read failed", async () => {
    const results = [Promise.reject(new Error("offline")), Promise.resolve(new Uint8Array([4]))]
    const { cache, calls } = setup(() => results.shift()!)

    await expect(cache.read(`media:${hash}`)).rejects.toThrow("offline")
    expect(cache.peek(`media:${hash}`)).toBeUndefined()
    expect(await cache.read(`media:${hash}`)).toEqual(new Uint8Array([4]))
    expect(calls).toEqual([hash, hash])
  })

  test("never requests anything for a URI that is not a media ref", async () => {
    const { cache, calls } = setup(async () => new Uint8Array())

    expect(cache.peek("data:image/png;base64,AAA")).toBeUndefined()
    await expect(cache.read("data:image/png;base64,AAA")).rejects.toThrow("Not a media ref")
    await expect(cache.read(`media:${hash.toUpperCase()}`)).rejects.toThrow("Not a media ref")
    expect(calls).toEqual([])
  })
})
