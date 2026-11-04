import { describe, expect, test } from "bun:test"
import { Duration, Schema } from "effect"
import { Info } from "@opencode/schema/config"

const decode = Schema.decodeUnknownSync(Info)

describe("config warming", () => {
  test("accepts boolean enablement", () => {
    expect(decode({}).warming).toBeUndefined()
    expect(decode({ warming: false }).warming).toBe(false)
    expect(decode({ warming: true }).warming).toBe(true)
  })

  test("decodes custom durations", () => {
    const warming = decode({
      warming: { interval: "2 minutes", duration: "1 hour", idle: "10 minutes" },
    }).warming
    expect(typeof warming).toBe("object")
    if (typeof warming !== "object") return
    expect(warming.interval).toEqual(Duration.minutes(2))
    expect(warming.duration).toEqual(Duration.hours(1))
    expect(warming.idle).toEqual(Duration.minutes(10))
  })

  test("still accepts the retired keep-alive prompt", () => {
    expect(decode({ warming: { prompt: "Reply pong" } }).warming).toMatchObject({ prompt: "Reply pong" })
  })
})
