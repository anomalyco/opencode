import { describe, expect, test } from "bun:test"
import {
  EFFORTS,
  NAMES,
  discoverModelIDs,
  effortsFor,
  exchangeSubscriptionKey,
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
      startDeviceAuthorization(
        (async () => Response.json({ ...device, verification_uri: "https://evil.example" })) as typeof fetch,
      ),
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
})
