import { afterEach, describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Trigger } from "../../src/trigger"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

describe("trigger service", () => {
  test("creates triggers per instance and fires them later", async () => {
    await using a = await tmpdir({ git: true })
    await using b = await tmpdir({ git: true })

    await Instance.provide({
      directory: a.path,
      fn: async () => {
        const item = await Trigger.create({ interval: 20 })
        const list = await Trigger.list()
        expect(list).toHaveLength(1)
        expect(list[0]).toMatchObject({
          id: item.id,
          schedule: { interval: 20 },
          runs: 0,
        })

        await Bun.sleep(80)

        const next = (await Trigger.list())[0]
        expect(next?.runs).toBeGreaterThan(0)
        expect(next?.time.last).toBeGreaterThanOrEqual(next!.time.created)
      },
    })

    await Instance.provide({
      directory: b.path,
      fn: async () => {
        expect(await Trigger.list()).toEqual([])
      },
    })
  })
})
