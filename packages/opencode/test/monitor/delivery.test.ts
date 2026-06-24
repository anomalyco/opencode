import { describe, expect, test } from "bun:test"
import { delivery, signHmacSha256, verifyHmacSha256, getProvider } from "@/monitor/webhook"

describe("monitor/webhook HMAC", () => {
  test("signHmacSha256 produces 64 hex chars", () => {
    const sig = signHmacSha256("hello", "secret")
    expect(sig).toMatch(/^[0-9a-f]{64}$/)
  })

  test("verifyHmacSha256 accepts matching signature", () => {
    const body = '{"x":1}'
    const secret = "topsecret"
    const sig = signHmacSha256(body, secret)
    expect(verifyHmacSha256(body, secret, sig)).toBe(true)
  })

  test("verifyHmacSha256 rejects wrong secret", () => {
    const body = '{"x":1}'
    const sig = signHmacSha256(body, "a")
    expect(verifyHmacSha256(body, "b", sig)).toBe(false)
  })

  test("verifyHmacSha256 rejects malformed signature", () => {
    expect(verifyHmacSha256("{}", "secret", "tooshort")).toBe(false)
  })
})

describe("monitor/webhook delivery", () => {
  test("delivery to unreachable URL reports failure (no throw)", async () => {
    const result = await delivery({
      url: "http://127.0.0.1:1/never",
      body: { hello: "world" },
      timeoutMs: 500,
      maxAttempts: 1,
    })
    expect(result.ok).toBe(false)
    expect(result.attempts).toBe(1)
    expect(result.error).toBeDefined()
  })

  test("delivery respects signal abort", async () => {
    const controller = new AbortController()
    const promise = delivery({
      url: "http://127.0.0.1:1/never",
      body: {},
      timeoutMs: 10_000,
      maxAttempts: 3,
      signal: controller.signal,
    })
    controller.abort()
    const result = await promise
    expect(result.ok).toBe(false)
  })

  test("delivery sends HMAC signature header when secret provided", async () => {
    let receivedSig: string | null = null
    let receivedBody = ""
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        receivedSig = req.headers.get("x-monitor-signature")
        return req.text().then((body) => {
          receivedBody = body
          return new Response("ok", { status: 200 })
        })
      },
    })
    try {
      const secret = "supersecret"
      const body = { ok: 1 }
      const result = await delivery({
        url: `http://127.0.0.1:${server.port}/hook`,
        body,
        hmacSecret: secret,
        maxAttempts: 1,
      })
      expect(result.ok).toBe(true)
      expect(receivedSig).toBeDefined()
      expect(receivedBody).toBe(JSON.stringify(body))
      expect(verifyHmacSha256(receivedBody, secret, receivedSig!)).toBe(true)
    } finally {
      server.stop()
    }
  })
})

describe("monitor/webhook provider resolveURL", () => {
  test("telegram derives URL from bot_token", () => {
    const tg = getProvider("telegram")
    const url = tg.resolveURL({
      credentials: { bot_token: "ABC", chat_id: "123" },
    })
    expect(url).toBe("https://api.telegram.org/botABC/sendMessage")
  })

  test("pagerduty uses a constant endpoint", () => {
    const pd = getProvider("pagerduty")
    expect(pd.resolveURL({ credentials: {} })).toBe("https://events.pagerduty.com/v2/enqueue")
  })

  test("opsgenie URL reflects region", () => {
    const og = getProvider("opsgenie")
    expect(og.resolveURL({ credentials: { region: "eu" } })).toBe("https://api.eu.opsgenie.com/")
    expect(og.resolveURL({ credentials: { region: "us" } })).toBe("https://api.opsgenie.com/")
  })
})