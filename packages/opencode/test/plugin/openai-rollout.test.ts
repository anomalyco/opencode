import { describe, expect, test } from "bun:test"
import { experimentalWebSocketsEnabled } from "../../src/plugin"

describe("plugin.openai.websocket rollout", () => {
  test("enables websockets by default only on pre-release channels", () => {
    expect(experimentalWebSocketsEnabled({ enabled: false, channel: "local" })).toBe(true)
    expect(experimentalWebSocketsEnabled({ enabled: false, channel: "dev" })).toBe(true)
    expect(experimentalWebSocketsEnabled({ enabled: false, channel: "beta" })).toBe(true)
    expect(experimentalWebSocketsEnabled({ enabled: false, channel: "latest" })).toBe(false)
    expect(experimentalWebSocketsEnabled({ enabled: false, channel: "prod" })).toBe(false)
  })

  test("allows releases to opt in through the experimental flag", () => {
    expect(experimentalWebSocketsEnabled({ enabled: true, channel: "latest" })).toBe(true)
    expect(experimentalWebSocketsEnabled({ enabled: true, channel: "prod" })).toBe(true)
  })
})
