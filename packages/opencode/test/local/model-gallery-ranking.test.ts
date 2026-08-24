import { describe, expect, test } from "bun:test"
import { hardCompatibility, filterCompatible } from "../../src/local/model-gallery/filter"
import { classifyRow } from "../../src/local/model-gallery/classify"
import { scoreRow, rankRows } from "../../src/local/model-gallery/rank"
import type { GalleryRow } from "../../src/local/model-gallery/join"
import type { HostVariantFit } from "../../src/local/model-gallery/fit"

// Hard filters (5.4), explained ranking (5.5), and state classification (5.6).

function variant(over: Partial<HostVariantFit> = {}): HostVariantFit {
  return {
    hostId: "http://m5:11435",
    candidateId: "unsloth/Qwen3-32B-GGUF",
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

function row(over: Partial<GalleryRow> = {}): GalleryRow {
  const variants = over.variants ?? [variant()]
  return {
    candidateId: "unsloth/Qwen3-32B-GGUF",
    hostId: "http://m5:11435",
    hostName: "m5",
    online: true,
    installed: false,
    fitKnown: true,
    bestVariant: variants[0] ?? null,
    recommendedVariant: "Q4_K_M",
    variants,
    vramFreeMB: 24000,
    vramTotalMB: 24576,
    ...over,
  }
}

const candidate = {
  policy: { allowed: true, reasons: [] as readonly string[] },
  capabilities: ["tools", "reasoning"] as readonly string[],
  provenance: { source: "huggingface" as const, freshness: "live" as const },
  architecture: "qwen3",
  name: "Qwen3-32B",
  downloads: 100_000,
  likes: 500,
}

describe("hard compatibility filters (5.4)", () => {
  test("a possible pair is compatible", () => {
    expect(hardCompatibility(row(), candidate)).toEqual({ compatible: true, reasons: [] })
  })

  test("a policy-blocked candidate is out", () => {
    const v = hardCompatibility(row(), { ...candidate, policy: { allowed: false, reasons: ["gated repo"] } })
    expect(v.compatible).toBe(false)
    expect(v.reasons).toContain("policy-blocked")
  })

  test("an offline host is out", () => {
    expect(hardCompatibility(row({ online: false }), candidate).reasons).toContain("host-offline")
  })

  test("a known no-fit is out", () => {
    const v = hardCompatibility(row({ bestVariant: null, variants: [variant({ fitLevel: "no" })] }), candidate)
    expect(v.reasons).toContain("no-fitting-variant")
  })

  test("an UNKNOWN fit does NOT disqualify", () => {
    // Filtering here would hide a perfectly good model because a host runs an
    // older llama-swap build, and the user could not tell that apart from the
    // model not existing. 5.6 labels it "unknown" instead.
    const v = hardCompatibility(row({ fitKnown: false, bestVariant: null, variants: [] }), candidate)
    expect(v.compatible).toBe(true)
  })

  test("a missing required capability is out", () => {
    const v = hardCompatibility(row(), candidate, { requiredCapabilities: ["vision"] })
    expect(v.reasons).toContain("capability-missing")
  })

  test("fitting but below the required context is out", () => {
    const v = hardCompatibility(row({ variants: [variant({ maxFitCtx: 32768 })] }), candidate, { minContext: 131072 })
    expect(v.reasons).toContain("context-too-small")
  })

  test("all applicable reasons are collected, not just the first", () => {
    // Naming one of three problems invites the user to fix it and find the
    // pair still unavailable.
    const v = hardCompatibility(row({ online: false }), { ...candidate, policy: { allowed: false, reasons: [] } })
    expect(v.reasons).toEqual(expect.arrayContaining(["policy-blocked", "host-offline"]))
  })

  test("filterCompatible keeps order and drops only the impossible", () => {
    const entries = [
      { row: row({ hostId: "a" }), candidate },
      { row: row({ hostId: "b", online: false }), candidate },
      { row: row({ hostId: "c" }), candidate },
    ]
    expect(filterCompatible(entries).map((e) => e.row.hostId)).toEqual(["a", "c"])
  })
})

describe("state classification (5.6)", () => {
  test("offline outranks everything else", () => {
    // A down host is also technically "nothing fits" and "not installed";
    // reporting either sends the user after a model problem they don't have.
    const c = classifyRow(row({ online: false, fitKnown: false, bestVariant: null }), candidate)
    expect(c.state).toBe("offline")
  })

  test("policy refusal is unsupported", () => {
    const c = classifyRow(row(), { ...candidate, policy: { allowed: false, reasons: ["gated repo"] } })
    expect(c.state).toBe("unsupported")
    expect(c.detail).toBe("gated repo")
  })

  test("installed outranks upgrade and fresh", () => {
    expect(classifyRow(row({ installed: true }), candidate).state).toBe("installed")
  })

  test("a known no-fit is unsupported", () => {
    expect(classifyRow(row({ bestVariant: null }), candidate).state).toBe("unsupported")
  })

  test("unknown outranks stale and the family labels", () => {
    // Claiming a fresh find on a host we could not query is an invention;
    // admitting we don't know is always true.
    const c = classifyRow(row({ fitKnown: false, bestVariant: null }), {
      ...candidate,
      provenance: { source: "seed", freshness: "stale-cache" },
    })
    expect(c.state).toBe("unknown")
  })

  test("stale catalog data is labelled stale", () => {
    const c = classifyRow(row(), { ...candidate, provenance: { source: "seed", freshness: "stale-cache" } })
    expect(c.state).toBe("stale")
  })

  test("a newer version of an installed family is an upgrade", () => {
    const c = classifyRow(row({ candidateId: "Qwen3.6-35B-A3B-GGUF" }), candidate, ["qwen3-32b"])
    expect(c.state).toBe("upgrade")
    expect(c.replaces).toBe("qwen3-32b")
  })

  test("same or newer already installed is not an upgrade", () => {
    const c = classifyRow(row({ candidateId: "Qwen3-32B-GGUF" }), candidate, ["qwen3.6-35b"])
    expect(c.state).not.toBe("upgrade")
  })

  test("an unrelated family is fresh", () => {
    expect(classifyRow(row({ candidateId: "gemma-3-27b" }), candidate, ["qwen3-32b"]).state).toBe("fresh")
  })
})

describe("explained ranking (5.5)", () => {
  test("the score is exactly the sum of its components", () => {
    // The UI may show the total, the top contributor, or the breakdown; none
    // of those may drift from each other.
    const ranked = scoreRow(row(), candidate, { desiredContext: 131072 })
    expect(ranked.score).toBe(ranked.components.reduce((s, c) => s + c.points, 0))
  })

  test("every component names itself and explains itself", () => {
    const ranked = scoreRow(row(), candidate, { desiredContext: 65536 })
    for (const c of ranked.components) {
      expect(c.detail.length).toBeGreaterThan(0)
      expect(typeof c.points).toBe("number")
    }
    expect(ranked.components.map((c) => c.kind)).toContain("fit")
    expect(ranked.components.map((c) => c.kind)).toContain("context")
  })

  test("compatibility outranks popularity", () => {
    // The epic states this explicitly: a well-fitting obscure model must beat
    // a barely-fitting popular one.
    const wellFitting = scoreRow(row(), { ...candidate, downloads: 10, likes: 0 })
    const barelyFitting = scoreRow(row({ variants: [variant({ fitLevel: "marginal" })] }), {
      ...candidate,
      downloads: 50_000_000,
      likes: 90_000,
    })
    expect(wellFitting.score).toBeGreaterThan(barelyFitting.score)
  })

  test("an unverifiable fit scores below a verified one", () => {
    const known = scoreRow(row(), candidate)
    const unknown = scoreRow(row({ fitKnown: false, bestVariant: null, variants: [] }), candidate)
    expect(unknown.score).toBeLessThan(known.score)
    expect(unknown.components.find((c) => c.kind === "fit")?.measured).toBe(false)
  })

  test("context scores relative to what was asked, and headroom is not extra credit", () => {
    const exact = scoreRow(row({ variants: [variant({ maxFitCtx: 65536 })] }), candidate, { desiredContext: 65536 })
    const surplus = scoreRow(row({ variants: [variant({ maxFitCtx: 262144 })] }), candidate, { desiredContext: 65536 })
    const short = scoreRow(row({ variants: [variant({ maxFitCtx: 16384 })] }), candidate, { desiredContext: 65536 })
    const ctx = (r: ReturnType<typeof scoreRow>) => r.components.find((c) => c.kind === "context")!.points
    expect(ctx(surplus)).toBe(ctx(exact))
    expect(ctx(short)).toBeLessThan(ctx(exact))
  })

  test("live catalog provenance beats a seed guess", () => {
    const live = scoreRow(row(), candidate)
    const seeded = scoreRow(row(), { ...candidate, provenance: { source: "seed", freshness: "seed" } })
    expect(live.score).toBeGreaterThan(seeded.score)
  })

  test("recency is computed against an injected clock, not wall time", () => {
    const now = new Date("2026-08-01T00:00:00Z")
    const recent = scoreRow(row(), candidate, { now, releaseDate: "2026-06-01T00:00:00Z" })
    const old = scoreRow(row(), candidate, { now, releaseDate: "2023-01-01T00:00:00Z" })
    const rec = (r: ReturnType<typeof scoreRow>) => r.components.find((c) => c.kind === "recency")?.points ?? 0
    expect(rec(recent)).toBeGreaterThan(rec(old))
  })

  test("an unparseable release date contributes nothing rather than NaN", () => {
    const ranked = scoreRow(row(), candidate, { releaseDate: "not-a-date" })
    expect(ranked.components.find((c) => c.kind === "recency")).toBeUndefined()
    expect(Number.isFinite(ranked.score)).toBe(true)
  })

  test("ranking is best-first and stable on ties", () => {
    const ranked = rankRows([
      { row: row({ hostId: "http://z:1" }), candidate },
      { row: row({ hostId: "http://a:1" }), candidate },
      { row: row({ hostId: "http://m:1", variants: [variant({ fitLevel: "tight" })] }), candidate },
    ])
    expect(ranked[0]!.row.hostId).toBe("http://a:1")
    expect(ranked[1]!.row.hostId).toBe("http://z:1")
    expect(ranked[2]!.row.hostId).toBe("http://m:1")
  })
})
