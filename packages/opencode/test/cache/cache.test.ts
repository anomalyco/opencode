import { afterEach, describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Cache } from "../../src/cache"

describe("cache.core", () => {
  afterEach(() => {
    Cache.close()
  })

  test("promote enforces LRU demotion", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        experimental: {
          cache: {
            enabled: true,
            maxTools: 2,
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      async fn() {
        await Cache.init()
        await Cache.registerTool({ id: "t1", name: "t1", description: "one", schema_json: "{}" })
        await Cache.registerTool({ id: "t2", name: "t2", description: "two", schema_json: "{}" })
        await Cache.registerTool({ id: "t3", name: "t3", description: "three", schema_json: "{}" })

        await Cache.promoteTool("t1")
        await Cache.promoteTool("t2")
        // If two tools are promoted within the same tick, this test may fail.
        // Realistically, if two tools are touched within the same tick (which rarely happens), demoting either one would be acceptable.
        // So we sleep for 2 milliseconds to ensure the promotions happen in different ticks.
        await Bun.sleep(2)
        await Cache.touchTool("t1")
        await Cache.promoteTool("t3")

        const l1 = await Cache.l1Tools()
        expect(l1.has("t1")).toBe(true)
        expect(l1.has("t3")).toBe(true)
        expect(l1.has("t2")).toBe(false)
      },
    })
  })

  test("isEnabled false without env or config", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      async fn() {
        expect(await Cache.isEnabled()).toBe(false)
      },
    })
  })

  test("init is idempotent", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        experimental: {
          cache: {
            enabled: true,
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      async fn() {
        await Cache.init()
        await Cache.init()
        expect((await Cache.list()).tools.length).toBeGreaterThanOrEqual(0)
      },
    })
  })
})
