import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { LLM, LLMClient } from "../../src/index.js"
import { MetaResponses } from "../../src/protocols/meta-responses.js"
import { compileRequest } from "../../src/route/client.js"
import { it } from "../lib/effect.js"
import { dynamicResponse } from "../lib/http.js"
import { sseEvents } from "../lib/sse.js"
import {
  EFFORTS,
  NAMES,
  RateLimitedError,
  configure,
  discoverModelIDs,
  model as museModel,
  effortsFor,
  exchangeSubscriptionKey,
  fetchQuota,
  pollDeviceToken,
  quotaOf,
  startDeviceAuthorization,
  variantSettings,
} from "../../src/providers/muse-code.js"

const device = {
  device_code: "fixture-device",
  user_code: "TEST-CODE",
  verification_uri: "https://auth.meta.com/device",
  expires_in: 60,
  interval: 1,
}

describe("muse-code model policy", () => {
  test("effort order is weakest to strongest with max last only on 1.3", () => {
    expect(EFFORTS).toEqual(["minimal", "low", "medium", "high", "xhigh"])
    expect(effortsFor("muse-spark-1.2")).toEqual(["minimal", "low", "medium", "high", "xhigh"])
    expect(effortsFor("muse-spark-1.3")).toEqual(["minimal", "low", "medium", "high", "xhigh", "max"])
    expect(effortsFor("muse-spark-1.3-contributor")).toEqual(["minimal", "low", "medium", "high", "xhigh"])
  })

  test("display labels are short and keep the Contributor distinction", () => {
    expect(NAMES["muse-spark-1.1"]).toBe("Spark 1.1")
    expect(NAMES["muse-spark-1.2"]).toBe("Spark 1.2")
    expect(NAMES["muse-spark-1.2-contributor"]).toBe("Spark 1.2 Contributor")
    expect(NAMES["muse-spark-1.3"]).toBe("Spark 1.3")
    expect(NAMES["muse-spark-1.3-contributor"]).toBe("Spark 1.3 Contributor")
  })

  test("variant settings match the shared Meta Responses handling", () => {
    expect(variantSettings("low")).toEqual({
      reasoningEffort: "low",
      reasoningSummary: "auto",
      include: ["reasoning.encrypted_content"],
    })
  })
})

describe("muse-code device authorization", () => {
  const fetchDevice = (async () => Response.json(device)) as typeof fetch

  test("device authorization validates the verification destination", async () => {
    const authorization = await startDeviceAuthorization(fetchDevice)
    expect(authorization.userCode).toBe("TEST-CODE")
    expect(authorization.url).toBe("https://auth.meta.com/device")
    expect(authorization.intervalMs).toBe(1000)
    await expect(
      startDeviceAuthorization((async () =>
        Response.json({ ...device, verification_uri: "https://evil.example" })) as typeof fetch),
    ).rejects.toThrow(/unverified/)
  })

  test("polling handles pending, slow_down, denial, and expiry", async () => {
    let clock = 0
    let polls = 0
    const waits: number[] = []
    const fetchFn = (async () => {
      polls += 1
      if (polls === 1) return Response.json({ error: "authorization_pending" }, { status: 400 })
      if (polls === 2) return Response.json({ error: "slow_down" }, { status: 400 })
      return Response.json({ access_token: "fixture-account" })
    }) as typeof fetch
    const token = await pollDeviceToken("fixture-device", fetchFn, {
      intervalMs: 1000,
      deadline: 60_000,
      now: () => clock,
      wait: async (ms: number) => {
        waits.push(ms)
        clock += ms
      },
    })
    expect(token).toBe("fixture-account")
    expect(waits).toEqual([1000, 1000, 6000])

    const denied = (async () => Response.json({ error: "access_denied" }, { status: 400 })) as typeof fetch
    await expect(
      pollDeviceToken("fixture-device", denied, { intervalMs: 0, deadline: 1000, now: () => 0, wait: async () => {} }),
    ).rejects.toThrow(/denied/)
    const expired = (async () => Response.json({ error: "expired_token" }, { status: 400 })) as typeof fetch
    await expect(
      pollDeviceToken("fixture-device", expired, { intervalMs: 0, deadline: 1000, now: () => 0, wait: async () => {} }),
    ).rejects.toThrow(/expired/)
  })
})

describe("muse-code subscription exchange", () => {
  test("onboarding requires a key and identity; quota lookups do not", async () => {
    const fetchFn = (async (url: unknown, init?: RequestInit) => {
      const onboard = JSON.parse(String(init?.body))?.onboard === true
      if (onboard) return Response.json({ api_key: "fixture-key", user_id: "fixture-user", is_subs_active: true })
      return Response.json({ is_subs_active: true, subs_usage: { window: { used_percent: 5 } } })
    }) as typeof fetch
    const onboarded = await exchangeSubscriptionKey("fixture-account", true, fetchFn)
    expect(onboarded).toMatchObject({ apiKey: "fixture-key", accountID: "fixture-user", active: true })
    const quota = await exchangeSubscriptionKey("fixture-account", false, fetchFn)
    expect(quota).toEqual({ active: true })
  })

  test("inactive subscriptions and billing actions fail closed", async () => {
    const inactive = (async () => Response.json({ is_subs_active: false })) as typeof fetch
    await expect(exchangeSubscriptionKey("fixture-account", true, inactive)).rejects.toThrow(/inactive/)
    const billing = (async () => Response.json({ require_payment: true })) as typeof fetch
    await expect(exchangeSubscriptionKey("fixture-account", true, billing)).rejects.toThrow(/billing/)
  })

  test("quota windows are allowlisted and redacted", () => {
    expect(
      quotaOf({ is_subs_active: true, subs_usage: { window: { used_percent: 12, window_duration_mins: 300 } } }),
    ).toEqual([{ window: "window", usedPercent: 12, durationMinutes: 300 }])
    expect(quotaOf({})).toEqual([])
  })

  test("discovery separates entitled models from unknown revisions", async () => {
    const fetchFn = (async () =>
      Response.json({ data: [{ id: "muse-spark-1.3" }, { id: "muse-spark-99" }] })) as typeof fetch
    await expect(discoverModelIDs("fixture-key", fetchFn)).resolves.toEqual({
      entitled: ["muse-spark-1.3"],
      unknown: ["muse-spark-99"],
    })
  })

  test("quota lookups are redacted and never mint keys", async () => {
    const bodies: string[] = []
    const fetchFn = (async (_url: unknown, init?: RequestInit) => {
      bodies.push(String(JSON.parse(String(init?.body))?.onboard ?? false))
      return Response.json({ is_subs_active: true, subs_usage: { window: { used_percent: 7 } } })
    }) as typeof fetch
    await expect(fetchQuota("fixture-account", fetchFn)).resolves.toEqual({
      active: true,
      windows: [{ window: "window", usedPercent: 7 }],
    })
    expect(bodies).toEqual(["false"])
  })

  test("rate limiting carries the Retry-After horizon", async () => {
    const limited = (async () => new Response("{}", { status: 429, headers: { "retry-after": "120" } })) as typeof fetch
    const failure = await exchangeSubscriptionKey("fixture-account", true, limited).catch((error) => error)
    expect(failure).toBeInstanceOf(RateLimitedError)
    expect((failure as RateLimitedError).retryAfterMs).toBe(120_000)
  })

  test("the default poll wait is cancellable", async () => {
    const controller = new AbortController()
    const pending = (async () => {
      await new Promise((_resolve, reject) =>
        controller.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }),
      )
    }) as typeof fetch
    const polled = pollDeviceToken("fixture-device", pending, {
      intervalMs: 60_000,
      deadline: Date.now() + 120_000,
      signal: controller.signal,
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    controller.abort()
    await expect(polled).rejects.toThrow(/cancelled/)
  })

  test("inference rejects unverified base URLs instead of moving credentials", () => {
    expect(() => configure({ baseURL: "https://evil.example/v1" })).toThrow(/unverified/)
    expect(() => configure({ apiKey: "fixture-key" }).responses("muse-spark-1.3")).not.toThrow()
  })
})

describe("muse-code transport", () => {
  const tools = [{ name: "read", description: "Read a file", inputSchema: { type: "object" } }]

  it.effect("sends the subscription key only to the verified Responses endpoint", () =>
    Effect.gen(function* () {
      const responses = configure({ apiKey: "fixture-subscription-key" }).responses("muse-spark-1.3")
      expect(responses.provider).toBe("muse-code")
      expect(responses.route.providerMetadataKey).toBe("muse-code")
      expect(responses.route.endpoint.baseURL).toBe("https://api.meta.ai/v1")
      expect(responses.route.body).toBe(MetaResponses.protocol.body)
      const compiled = yield* compileRequest(LLM.request({ model: responses, prompt: "Hello", tools }))
      expect(compiled.protocol).toBe("meta-responses")
      expect(compiled.body).toMatchObject({
        model: "muse-spark-1.3",
        store: false,
        include: ["reasoning.encrypted_content"],
      })
      expect(JSON.stringify(compiled.body.tools)).toContain('"read"')
      const response = yield* LLMClient.generate(LLM.request({ model: responses, prompt: "Hello", tools })).pipe(
        Effect.provide(
          dynamicResponse((input) =>
            Effect.sync(() => {
              expect(input.request.method).toBe("POST")
              expect(input.request.url).toBe("https://api.meta.ai/v1/responses")
              expect(input.request.headers.authorization).toBe("Bearer fixture-subscription-key")
              expect(JSON.parse(input.text)).toMatchObject({ model: "muse-spark-1.3", stream: true, store: false })
              return input.respond(
                sseEvents(
                  { type: "response.created", response: { id: "resp_muse" } },
                  {
                    type: "response.output_item.done",
                    output_index: 0,
                    item: {
                      id: "msg_muse",
                      type: "message",
                      role: "assistant",
                      content: [{ type: "output_text", text: "MUSE_SUBSCRIPTION_OK" }],
                    },
                  },
                  { type: "response.completed", response: { id: "resp_muse" } },
                ),
                { headers: { "content-type": "text/event-stream" } },
              )
            }),
          ),
        ),
      )
      expect(response.text).toBe("MUSE_SUBSCRIPTION_OK")
    }),
  )

  it.effect("settings select models without inheriting environment credentials", () =>
    Effect.gen(function* () {
      const selected = museModel("muse-spark-1.2", { apiKey: "explicit-key" })
      expect(selected.route.endpoint.baseURL).toBe("https://api.meta.ai/v1")
      const compiled = yield* compileRequest(LLM.request({ model: selected, prompt: "Hello" }))
      expect(compiled.body).toMatchObject({ store: false })
    }),
  )
})
