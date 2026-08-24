import { describe, expect, test } from "bun:test"
import { discoverGalleryHosts, hostId, type GalleryHost } from "../../src/local/model-gallery/hosts"
import { evaluateFitAcrossHosts, type FitCandidate, type HypotheticalFitter } from "../../src/local/model-gallery/fit"
import { bestFittingVariant, joinGalleryRows } from "../../src/local/model-gallery/join"
import type { HostVariantFit } from "../../src/local/model-gallery/fit"

// Gallery data plane: host enumeration (5.1), batched multi-host hypothetical
// fit (5.2), and the join by stable identity (5.3).
//
// The property these three share, and the one most of these tests are really
// about: "we could not ask" must never collapse into "the answer is no". An
// offline host, a build without the endpoint, and a genuine does-not-fit each
// need to stay distinguishable all the way through to the UI.

function svc(over: Partial<Record<string, unknown>> = {}) {
  return {
    name: "m5",
    host: "m5.local",
    port: 11435,
    baseURL: "http://m5.local:11435",
    source: "mdns" as const,
    models: ["qwen3-32b"],
    defaultModel: "qwen3-32b",
    online: true,
    mtpMetadata: {},
    ...over,
  }
}

const fakeScan = (services: unknown[]) => (async () => services) as never

describe("gallery host enumeration (5.1)", () => {
  test("projects opencode's existing discovery rather than rediscovering", async () => {
    const hosts = await discoverGalleryHosts({ scan: fakeScan([svc()]) })
    expect(hosts).toHaveLength(1)
    expect(hosts[0]).toMatchObject({
      id: "http://m5.local:11435",
      name: "m5",
      online: true,
      installedModelIDs: ["qwen3-32b"],
    })
  })

  test("keeps offline hosts instead of filtering them out", async () => {
    // 5.6 must be able to say "this model exists but that host is offline".
    // Dropping the host here would make it indistinguishable from a host the
    // user never had.
    const hosts = await discoverGalleryHosts({
      scan: fakeScan([svc({ online: false, models: [] })]),
    })
    expect(hosts).toHaveLength(1)
    expect(hosts[0]!.online).toBe(false)
  })

  test("collapses duplicate discoveries of one endpoint, preferring the one that answered", async () => {
    const hosts = await discoverGalleryHosts({
      scan: fakeScan([
        svc({ source: "lan", online: false, models: [], name: "stale-dns-name" }),
        svc({ source: "mdns", online: true, models: ["qwen3-32b"], name: "m5" }),
      ]),
    })
    expect(hosts).toHaveLength(1)
    expect(hosts[0]!.name).toBe("m5")
    expect(hosts[0]!.online).toBe(true)
  })

  test("host ids are normalized so a trailing slash is not a second host", () => {
    expect(hostId("http://M5.local:11435/")).toBe(hostId("http://m5.local:11435"))
  })

  test("listing order is stable across refreshes", async () => {
    const services = [svc({ baseURL: "http://b:1" }), svc({ baseURL: "http://a:1" })]
    const first = await discoverGalleryHosts({ scan: fakeScan(services) })
    const second = await discoverGalleryHosts({ scan: fakeScan([...services].reverse()) })
    expect(first.map((h) => h.id)).toEqual(second.map((h) => h.id))
  })
})

function onlineHost(over: Partial<GalleryHost> = {}): GalleryHost {
  return {
    id: "http://m5:11435",
    name: "m5",
    baseURL: "http://m5:11435",
    source: "mdns",
    online: true,
    installedModelIDs: [],
    defaultModel: null,
    ...over,
  }
}

const candidate: FitCandidate = {
  candidateId: "unsloth/Qwen3-32B-GGUF",
  model: "unsloth/Qwen3-32B-GGUF",
  variants: [
    { name: "Q4_K_M", fileBytes: 19_000_000_000 },
    { name: "Q8_0", fileBytes: 35_000_000_000 },
  ],
}

/** Records every request so batching and bounding can be asserted. */
function recordingFitter(response: unknown, opts: { fail?: boolean; delayMs?: number } = {}) {
  const calls: Array<{ baseURL: string; body: unknown }> = []
  let inFlight = 0
  let peak = 0
  const make = (baseURL: string): HypotheticalFitter => ({
    async postHypotheticalFit(args) {
      calls.push({ baseURL, body: args.body })
      inFlight++
      peak = Math.max(peak, inFlight)
      try {
        if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs))
        if (opts.fail) throw new Error("boom")
        return response
      } finally {
        inFlight--
      }
    },
  })
  return { make, calls, peak: () => peak }
}

const goodResponse = {
  data: {
    estimated: false,
    recommended: "Q4_K_M",
    vram_free_mb: 24000,
    vram_total_mb: 24576,
    variants: [
      { name: "Q4_K_M", fit_level: "good", max_fit_ctx: 131072, vram_required_mb: 20000, model_mb: 18000 },
      { name: "Q8_0", fit_level: "no", max_fit_ctx: 0, vram_required_mb: 40000, model_mb: 33000, reason: "needs 39 GB" },
    ],
  },
}

describe("multi-host hypothetical fit (5.2)", () => {
  test("batches a candidate's variants into ONE request per host", async () => {
    const f = recordingFitter(goodResponse)
    const hosts = [onlineHost({ id: "http://a:1", baseURL: "http://a:1" }), onlineHost({ id: "http://b:1", baseURL: "http://b:1" })]

    const results = await evaluateFitAcrossHosts(hosts, [candidate], { fitter: f.make })

    expect(f.calls).toHaveLength(2) // 2 hosts x 1 candidate, NOT x 2 variants
    expect((f.calls[0]!.body as { variants: unknown[] }).variants).toHaveLength(2)
    expect(results).toHaveLength(2)
    expect(results.every((r) => r.answered)).toBe(true)
  })

  test("caps requests in flight", async () => {
    const f = recordingFitter(goodResponse, { delayMs: 15 })
    const hosts = Array.from({ length: 8 }, (_, i) => onlineHost({ id: `http://h${i}:1`, baseURL: `http://h${i}:1` }))

    await evaluateFitAcrossHosts(hosts, [candidate], { fitter: f.make, concurrency: 3 })

    expect(f.calls).toHaveLength(8)
    expect(f.peak()).toBeLessThanOrEqual(3)
  })

  test("an offline host is never contacted but still yields a result", async () => {
    const f = recordingFitter(goodResponse)
    const hosts = [onlineHost({ id: "http://off:1", baseURL: "http://off:1", online: false })]

    const results = await evaluateFitAcrossHosts(hosts, [candidate], { fitter: f.make })

    expect(f.calls).toHaveLength(0)
    expect(results).toHaveLength(1)
    expect(results[0]!.answered).toBe(false)
  })

  test("a failing host degrades to unanswered instead of taking the fan-out down", async () => {
    const ok = recordingFitter(goodResponse)
    const bad = recordingFitter(goodResponse, { fail: true })
    const hosts = [
      onlineHost({ id: "http://good:1", baseURL: "http://good:1" }),
      onlineHost({ id: "http://bad:1", baseURL: "http://bad:1" }),
    ]

    const results = await evaluateFitAcrossHosts(hosts, [candidate], {
      fitter: (url) => (url.includes("bad") ? bad.make(url) : ok.make(url)),
    })

    const byHost = new Map(results.map((r) => [r.hostId, r]))
    expect(byHost.get("http://good:1")!.answered).toBe(true)
    expect(byHost.get("http://bad:1")!.answered).toBe(false)
  })

  test("a reshaped or empty response is unknown, not a refusal", async () => {
    for (const body of [{ data: {} }, { data: { variants: [] } }, null, "nonsense"]) {
      const f = recordingFitter(body)
      const results = await evaluateFitAcrossHosts([onlineHost()], [candidate], { fitter: f.make })
      expect(results[0]!.answered).toBe(false)
      expect(results[0]!.variants).toEqual([])
    }
  })

  test("reads per-variant verdicts including llama-skein's own reason text", async () => {
    const f = recordingFitter(goodResponse)
    const [result] = await evaluateFitAcrossHosts([onlineHost()], [candidate], { fitter: f.make })
    expect(result!.recommendedVariant).toBe("Q4_K_M")
    expect(result!.vramFreeMB).toBe(24000)
    const q8 = result!.variants.find((v) => v.variantName === "Q8_0")!
    expect(q8.fitLevel).toBe("no")
    expect(q8.reason).toBe("needs 39 GB")
  })

  test("params_b is sent only when there are no variant sizes to send instead", async () => {
    const f = recordingFitter(goodResponse)
    await evaluateFitAcrossHosts([onlineHost()], [{ ...candidate, paramsB: 32 }], { fitter: f.make })
    expect((f.calls[0]!.body as Record<string, unknown>)["params_b"]).toBeUndefined()

    const g = recordingFitter(goodResponse)
    await evaluateFitAcrossHosts([onlineHost()], [{ ...candidate, variants: [], paramsB: 32 }], { fitter: g.make })
    expect((g.calls[0]!.body as Record<string, unknown>)["params_b"]).toBe(32)
  })
})

function variant(over: Partial<HostVariantFit> = {}): HostVariantFit {
  return {
    hostId: "http://m5:11435",
    candidateId: "c1",
    variantName: "Q4_K_M",
    known: true,
    fitLevel: "good",
    maxFitCtx: 131072,
    vramRequiredMB: 20000,
    modelMB: 18000,
    reason: "",
    ...over,
  }
}

describe("gallery join (5.3)", () => {
  const host = onlineHost({ installedModelIDs: ["qwen3-32b"] })

  test("emits one row per candidate/host pair, in stable order", () => {
    const rows = joinGalleryRows({
      hosts: [onlineHost({ id: "http://a:1" }), onlineHost({ id: "http://b:1" })],
      candidates: [{ candidateId: "c1" }, { candidateId: "c2" }],
      fits: [],
    })
    expect(rows.map((r) => `${r.candidateId}@${r.hostId}`)).toEqual([
      "c1@http://a:1",
      "c1@http://b:1",
      "c2@http://a:1",
      "c2@http://b:1",
    ])
  })

  test("joins fit onto the right pair and surfaces the best fitting variant", () => {
    const rows = joinGalleryRows({
      hosts: [host],
      candidates: [{ candidateId: "c1" }],
      fits: [
        {
          hostId: host.id,
          candidateId: "c1",
          answered: true,
          recommendedVariant: "Q4_K_M",
          estimated: false,
          vramFreeMB: 24000,
          vramTotalMB: 24576,
          variants: [variant({ variantName: "Q8_0", fitLevel: "no" }), variant()],
        },
      ],
    })
    expect(rows[0]!.fitKnown).toBe(true)
    expect(rows[0]!.bestVariant?.variantName).toBe("Q4_K_M")
    expect(rows[0]!.vramFreeMB).toBe(24000)
  })

  test("a pair with no fit entry is unknown, not unfitting", () => {
    const rows = joinGalleryRows({ hosts: [host], candidates: [{ candidateId: "c1" }], fits: [] })
    expect(rows[0]!.fitKnown).toBe(false)
    expect(rows[0]!.bestVariant).toBeNull()
  })

  test("installed is matched against the host's served models, including aliases", () => {
    const rows = joinGalleryRows({
      hosts: [host],
      candidates: [{ candidateId: "unsloth/Qwen3-32B-GGUF", installedAliases: ["qwen3-32b"] }],
      fits: [],
    })
    expect(rows[0]!.installed).toBe(true)
  })

  test("an unreachable capacity probe leaves busy unknown rather than false", () => {
    // "idle" and "we have no idea" must not be the same value, or a scheduler
    // reads an unreachable host as free and dispatches into a hole.
    const rows = joinGalleryRows({
      hosts: [host],
      candidates: [{ candidateId: "c1" }],
      fits: [],
      capacity: [{ provider: "m5", baseURL: host.baseURL, reachable: false, probedAt: 0, ageMs: 0, stale: false }],
    })
    expect(rows[0]!.busy).toBeUndefined()
  })

  test("capacity is matched through the same normalization as host ids", () => {
    const rows = joinGalleryRows({
      hosts: [host],
      candidates: [{ candidateId: "c1" }],
      fits: [],
      // Trailing slash: a naive string key would silently lose the signal.
      capacity: [
        { provider: "m5", baseURL: host.baseURL + "/", reachable: true, busy: true, probedAt: 0, ageMs: 0, stale: false },
      ],
    })
    expect(rows[0]!.busy).toBe(true)
  })
})

describe("bestFittingVariant", () => {
  test("prefers fit quality, then the largest context", () => {
    const best = bestFittingVariant([
      variant({ variantName: "Q4_K_M", fitLevel: "tight", maxFitCtx: 262144 }),
      variant({ variantName: "Q5_K_M", fitLevel: "good", maxFitCtx: 65536 }),
      variant({ variantName: "Q6_K", fitLevel: "good", maxFitCtx: 131072 }),
    ])
    expect(best?.variantName).toBe("Q6_K")
  })

  test("ignores verdicts that are not a fit level at all", () => {
    expect(bestFittingVariant([variant({ fitLevel: "no" }), variant({ fitLevel: "unknown" })])).toBeNull()
  })
})
