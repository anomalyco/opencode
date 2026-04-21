import { describe, expect, test, beforeEach, afterAll } from "bun:test"
import fs from "fs"
import path from "path"
import { Global } from "../src/global"
import { RateLimit } from "../src/provider/rate-limit"
import { ProviderID } from "../src/provider/schema"

const provider = ProviderID.make("test-provider")
const configPath = path.join(Global.Path.config, "opencode.json")

beforeEach(() => {
  RateLimit.reset()
  if (fs.existsSync(configPath)) fs.rmSync(configPath)
})

afterAll(() => {
  if (fs.existsSync(configPath)) fs.rmSync(configPath)
})

describe("RateLimit", () => {
  test("tick counts requests in both windows", () => {
    RateLimit.tick(provider)
    RateLimit.tick(provider)
    RateLimit.tick(provider)
    const snap = RateLimit.snapshot(provider)
    expect(snap.minute.count).toBe(3)
    expect(snap.day.count).toBe(3)
  })

  test("recordResponse parses x-ratelimit-* headers", () => {
    const headers = new Headers({
      "x-ratelimit-limit-requests": "1000",
      "x-ratelimit-remaining-requests": "997",
      "x-ratelimit-reset-requests": "30",
    })
    RateLimit.recordResponse(provider, headers)
    const snap = RateLimit.snapshot(provider)
    expect(snap.headers?.requests?.limit).toBe(1000)
    expect(snap.headers?.requests?.remaining).toBe(997)
    expect(snap.headers?.requests?.resetAt).toBeGreaterThan(Date.now())
  })

  test("onRateLimitError persists the current counter to opencode.json", () => {
    for (let i = 0; i < 7; i++) RateLimit.tick(provider)
    RateLimit.onRateLimitError(provider)
    expect(fs.existsSync(configPath)).toBe(true)
    const written = JSON.parse(fs.readFileSync(configPath, "utf8"))
    expect(written.provider[provider].options.rateLimit.perMinute).toBe(7)
    expect(written.provider[provider].options.rateLimit.perDay).toBe(7)
  })

  test("onRateLimitError only bumps learned limits upward", () => {
    fs.mkdirSync(Global.Path.config, { recursive: true })
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        provider: { [provider]: { options: { rateLimit: { perMinute: 50, perDay: 500 } } } },
      }),
    )
    for (let i = 0; i < 3; i++) RateLimit.tick(provider)
    RateLimit.onRateLimitError(provider)
    const written = JSON.parse(fs.readFileSync(configPath, "utf8"))
    expect(written.provider[provider].options.rateLimit.perMinute).toBe(50)
    expect(written.provider[provider].options.rateLimit.perDay).toBe(500)
  })

  test("onRateLimitError skips write when opencode.jsonc exists", () => {
    const jsoncPath = path.join(Global.Path.config, "opencode.jsonc")
    fs.mkdirSync(Global.Path.config, { recursive: true })
    fs.writeFileSync(jsoncPath, "// comments preserved\n{}\n")
    try {
      for (let i = 0; i < 4; i++) RateLimit.tick(provider)
      RateLimit.onRateLimitError(provider)
      expect(fs.existsSync(configPath)).toBe(false)
    } finally {
      if (fs.existsSync(jsoncPath)) fs.rmSync(jsoncPath)
    }
  })

  test("check returns ok:true when no limits configured", () => {
    const gate = RateLimit.check(provider, 1000)
    expect(gate.ok).toBe(true)
  })

  test("check trips on requests-minute when at limit", () => {
    RateLimit.configure(provider, { perMinute: 3 })
    RateLimit.tick(provider)
    RateLimit.tick(provider)
    RateLimit.tick(provider)
    const gate = RateLimit.check(provider)
    expect(gate.ok).toBe(false)
    if (!gate.ok) {
      expect(gate.reason).toBe("requests-minute")
      expect(gate.limit).toBe(3)
      expect(gate.current).toBe(3)
      expect(gate.resetAt).toBeGreaterThan(Date.now())
    }
  })

  test("check trips on tokens-minute when estimate would exceed limit", () => {
    RateLimit.configure(provider, { tokensPerMinute: 1000 })
    RateLimit.tick(provider, 900)
    const gate = RateLimit.check(provider, 200)
    expect(gate.ok).toBe(false)
    if (!gate.ok) {
      expect(gate.reason).toBe("tokens-minute")
      expect(gate.limit).toBe(1000)
    }
  })

  test("check respects tokens-day limit", () => {
    RateLimit.configure(provider, { tokensPerDay: 500 })
    RateLimit.tick(provider, 400)
    const gate = RateLimit.check(provider, 200)
    expect(gate.ok).toBe(false)
    if (!gate.ok) expect(gate.reason).toBe("tokens-day")
  })

  test("recordUsage replaces the oldest pending token estimate", () => {
    RateLimit.tick(provider, 500)
    RateLimit.recordUsage(provider, 200, 50)
    const snap = RateLimit.snapshot(provider)
    expect(snap.tokensMinute.count).toBe(250)
  })

  test("estimateRequestTokens handles string, bytes, and objects", () => {
    expect(RateLimit.estimateRequestTokens(undefined)).toBe(0)
    expect(RateLimit.estimateRequestTokens("a".repeat(40))).toBe(10)
    expect(RateLimit.estimateRequestTokens(new TextEncoder().encode("b".repeat(40)))).toBe(10)
    expect(RateLimit.estimateRequestTokens({ content: "hello world" })).toBeGreaterThan(0)
  })

  test("onRateLimitError persists learned token limits", () => {
    RateLimit.tick(provider, 1500)
    RateLimit.tick(provider, 2500)
    RateLimit.onRateLimitError(provider)
    const written = JSON.parse(fs.readFileSync(configPath, "utf8"))
    expect(written.provider[provider].options.rateLimit.tokensPerMinute).toBe(4000)
    expect(written.provider[provider].options.rateLimit.tokensPerDay).toBe(4000)
  })

  test("check prefers server-advertised remaining when it's tighter", () => {
    RateLimit.recordResponse(
      provider,
      new Headers({
        "x-ratelimit-limit-requests": "100",
        "x-ratelimit-remaining-requests": "0",
        "x-ratelimit-reset-requests": "30",
      }),
    )
    const gate = RateLimit.check(provider)
    expect(gate.ok).toBe(false)
    if (!gate.ok) expect(gate.reason).toBe("requests-minute")
  })
})
