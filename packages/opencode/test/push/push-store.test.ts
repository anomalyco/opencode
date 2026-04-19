import { beforeEach, describe, expect, test } from "bun:test"
import { Database } from "../../src/storage"
import { Push } from "../../src/push"
import { PushSubscriptionTable } from "../../src/push/push.sql"

describe("push subscription store", () => {
  beforeEach(() => {
    Database.use((db) => db.delete(PushSubscriptionTable).run())
  })

  test("upserts and removes subscriptions with device metadata", () => {
    const saved = Push.upsert({
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

    const listed = Push.list()
    expect(listed).toHaveLength(1)
    expect(listed[0]?.id).toBe(saved.id)
    expect(listed[0]?.deviceLabel).toBe("Android Chrome")

    expect(Push.removeSubscription(saved.id)).toBe(true)
    expect(Push.list()).toHaveLength(0)
  })
})
