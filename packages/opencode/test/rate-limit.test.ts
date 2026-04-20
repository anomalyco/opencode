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
})
