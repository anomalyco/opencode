import { beforeEach, describe, expect, test } from "bun:test"
import { Database } from "@opencode-ai/core/database/database"
import { makeRuntime } from "@opencode-ai/core/effect/runtime"
import { Effect } from "effect"
import { Push } from "../../src/push"
import { PushDeliveryTable, PushSubscriptionTable } from "../../src/push/push.sql"

const runtime = makeRuntime(Database.Service, Database.layerFromPath(Database.path()))

describe("push subscription store", () => {
  beforeEach(async () => {
    await runtime.runPromise(({ db }) =>
      Effect.gen(function* () {
        yield* db.delete(PushDeliveryTable).run()
        yield* db.delete(PushSubscriptionTable).run()
      }).pipe(Effect.orDie),
    )
  })

  test("upserts and removes subscriptions with device metadata", async () => {
    const saved = await Push.upsert({
      deviceLabel: "Android Chrome",
      endpoint: "https://example.com/subscription/1",
      keys: {
        auth: "auth-key",
        p256dh: "p256dh-key",
      },
      notifyOnCompletion: true,
      notifyOnError: false,
      serverOrigin: "https://opencode.tim-ur.ru",
      userAgent: "Mozilla/5.0",
    })

    expect(saved.deviceLabel).toBe("Android Chrome")
    expect(saved.failureCount).toBe(0)
    expect(saved.lastError).toBeUndefined()
    expect(saved.serverOrigin).toBe("https://opencode.tim-ur.ru")
    expect(saved.notifyOnCompletion).toBe(true)

    const listed = await Push.list()
    expect(listed).toHaveLength(1)
    expect(listed[0]?.id).toBe(saved.id)
    expect(listed[0]?.deviceLabel).toBe("Android Chrome")

    const updated = await Push.update({
      id: saved.id,
      value: {
        deviceLabel: "Pixel 8",
      },
    })

    expect(updated.deviceLabel).toBe("Pixel 8")

    const muted = await Push.update({
      id: saved.id,
      value: {
        enabled: false,
      },
    })

    expect(muted.enabled).toBe(false)

    expect(await Push.removeSubscription(saved.id)).toBe(true)
    expect(await Push.list()).toHaveLength(0)
  })
})
