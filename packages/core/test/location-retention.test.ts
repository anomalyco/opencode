import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Location } from "@opencode/core/location"
import { LocationRetention } from "@opencode/core/location-retention"
import { LocationServiceMap } from "@opencode/core/location-services"
import { AbsolutePath } from "@opencode/core/schema"

const ref = (directory: string) => Location.Ref.make({ directory: AbsolutePath.make(directory) })

const setup = () => Effect.runPromise(LocationRetention.make)

describe("LocationRetention", () => {
  test("retains and releases a location", async () => {
    const retention = await setup()
    expect(await Effect.runPromise(retention.live())).toEqual([])
    await Effect.runPromise(retention.retain(ref("/tmp/a")))
    const live = await Effect.runPromise(retention.live())
    expect(live.length).toBe(1)
    expect(live[0]?.count).toBe(1)
    await Effect.runPromise(retention.release(ref("/tmp/a")))
    expect(await Effect.runPromise(retention.live())).toEqual([])
  })

  test("double retain needs double release", async () => {
    const retention = await setup()
    const location = ref("/tmp/a")
    await Effect.runPromise(retention.retain(location))
    await Effect.runPromise(retention.retain(location))
    await Effect.runPromise(retention.release(location))
    expect((await Effect.runPromise(retention.live())).length).toBe(1)
    await Effect.runPromise(retention.release(location))
    expect(await Effect.runPromise(retention.live())).toEqual([])
  })

  test("release of an unknown location is a no-op", async () => {
    const retention = await setup()
    await Effect.runPromise(retention.release(ref("/tmp/missing")))
    expect(await Effect.runPromise(retention.live())).toEqual([])
  })

  test("structurally equal refs share one entry", async () => {
    const retention = await setup()
    await Effect.runPromise(retention.retain(ref("/tmp/a")))
    await Effect.runPromise(retention.release(ref("/tmp/a")))
    expect(await Effect.runPromise(retention.live())).toEqual([])
  })

  test("shares identity with the activity sweep key", async () => {
    const retention = await setup()
    const directory = AbsolutePath.make("/tmp/a")
    await Effect.runPromise(
      retention.retain(Location.Ref.make({ directory, workspaceID: undefined })),
    )
    const live = await Effect.runPromise(retention.live())
    expect(live.length).toBe(1)
    expect(LocationRetention.keyOf(live[0]?.ref ?? ref("/tmp/never"))).toBe(
      LocationRetention.keyOf(LocationServiceMap.canonical(Location.Ref.make({ directory }))),
    )
    await Effect.runPromise(retention.release(Location.Ref.make({ directory })))
    expect(await Effect.runPromise(retention.live())).toEqual([])
  })
})
