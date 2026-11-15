import { describe, expect, mock, test } from "bun:test"
import { readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { buildOgWorker } from "../script/build-og-worker"
import { isDataBypassPath, parsePath } from "../src/lib/data-path"
import type { OgCard } from "../src/og/card"

// The catalog module behind the card builders defines a router query at import time, which throws outside a Solid
// server runtime.
mock.module("@solidjs/router", () => ({ query: (fn: unknown) => fn }))
const { labOgCard, modelOgCard, ogImageAlt, ogImageUrl, ogVersion } = await import("../src/og/card-data")

// The real in-process renderer, counted, and an in-memory stand-in for the Worker's edge cache, which local runs lack.
// `#resource` resolves to this same module, so take the real functions before replacing it.
const resource = { ...(await import("../src/lib/resource.node")) }
const renders: OgCard[] = []
const failing = new Set<string>()
const cached = new Map<string, Response>()
mock.module("#resource", () => ({
  ...resource,
  renderOgCard: (card: OgCard) => {
    renders.push(card)
    if (failing.has(card.path)) return Promise.reject(new Error("The renderer is down"))
    return resource.renderOgCard(card)
  },
  edgeCache: () => ({
    match: async (key: Request) => cached.get(key.url)?.clone(),
    put: async (key: Request, response: Response) => {
      cached.set(key.url, response)
    },
  }),
}))
const { ogResponse } = await import("../src/og/response")

const updatedAt = "2026-11-08T01:18:52.000Z"
const labs = [{ id: "thinkingmachines" }, { id: "nvidia" }]
const inkling = {
  path: "/data/thinkingmachines/inkling-2-small",
  catalog: { entry: { name: "Inkling 2 Small", lab: "thinkingmachines" }, labs },
  stats: {
    model: "inkling-2-small",
    provider: "thinkingmachines",
    rank: 20,
    totals: { tokens: 357_956_989_789 },
    usage: [
      { date: "Nov 4", tokens: 0 },
      { date: "Nov 5", tokens: 12_000_000_000 },
      { date: "Nov 6", tokens: 140_000_000_000 },
    ],
    updatedAt,
  },
}
const thinkingMachines = {
  lab: { id: "thinkingmachines", name: "Thinking Machines", models: [{}, {}, {}] },
  stats: { totals: { tokens: 357_961_076_097 }, usage: [{ date: "Nov 5", tokens: 12_000_000_000 }], updatedAt },
}

describe("og.png paths", () => {
  test("lab and model pages have an og image path", () => {
    expect(parsePath("/data/thinkingmachines/og.png")).toEqual({
      target: { kind: "lab", lab: "thinkingmachines" },
      extension: "/og.png",
      format: "og",
    })
    expect(parsePath("/data/thinkingmachines/inkling-2-small/og.png")).toEqual({
      target: { kind: "model", lab: "thinkingmachines", model: "inkling-2-small" },
      extension: "/og.png",
      format: "og",
    })
  })

  test("other pages and assets have none", () => {
    expect(parsePath("/data/og.png")).toBeUndefined()
    expect(parsePath("/data/compare/a/b/og.png")).toBeUndefined()
    expect(parsePath("/data/banner.png/og.png")).toBeUndefined()
    expect(parsePath("/data/thinkingmachines/inkling-2-small/extra/og.png")).toBeUndefined()
  })

  test("og images never redirect to the visitor's language", () => {
    expect(isDataBypassPath("/data/thinkingmachines/inkling-2-small/og.png")).toBe(true)
    expect(isDataBypassPath("/data/thinkingmachines/inkling-2-small")).toBe(false)
  })
})

describe("cards", () => {
  test("a ranked model shows its lab, rank and tokens", () => {
    const card = modelOgCard(inkling)
    expect(card).toMatchObject({
      kind: "model",
      name: "Inkling 2 Small",
      lab: { name: "Thinking Machines", icon: null },
      rank: 20,
      tokens: 357_956_989_789,
    })
    // The daily series starts at the first day with usage, for a chart design.
    expect(card?.days).toEqual([
      { date: "2026-11-05", tokens: 12_000_000_000 },
      { date: "2026-11-06", tokens: 140_000_000_000 },
    ])
    expect(card && ogImageAlt(card)).toBe(
      "Inkling 2 Small by Thinking Machines on OpenCode Data, ranked #20 last week with 358B tokens in the last 2 months.",
    )
  })

  test("a lab with a provider icon gets it", () => {
    const card = modelOgCard({
      ...inkling,
      path: "/data/nvidia/nemotron-3-5-lightning",
      catalog: { entry: { name: "Nemotron 3.5 Lightning 30B A3B", lab: "nvidia" }, labs },
    })
    expect(card?.kind === "model" && card.lab).toEqual({ name: "NVIDIA", icon: "nvidia" })
  })

  test("an unranked model with usage drops the rank", () => {
    const card = modelOgCard({ ...inkling, stats: { ...inkling.stats, rank: null } })
    expect(card && ogImageAlt(card)).toBe(
      "Inkling 2 Small by Thinking Machines on OpenCode Data, with 358B tokens in the last 2 months.",
    )
  })

  test("a model before its first usage shows only its name and lab", () => {
    const card = modelOgCard({ ...inkling, stats: null })
    expect(card).toMatchObject({ rank: null, tokens: 0, days: [], updatedAt: null })
    expect(card && ogImageAlt(card)).toBe("Inkling 2 Small by Thinking Machines on OpenCode Data.")
  })

  test("a stealth model has no lab line", () => {
    const card = modelOgCard({
      path: "/data/unknown/iceman",
      catalog: { entry: null, labs },
      stats: { ...inkling.stats, model: "iceman", provider: "unknown", rank: 3 },
    })
    expect(card).toMatchObject({ name: "iceman", lab: null })
    expect(card && ogImageAlt(card)).toStartWith("iceman on OpenCode Data, ranked #3")
  })

  test("a page that doesn't exist has no card", () => {
    expect(modelOgCard({ ...inkling, catalog: { entry: null, labs }, stats: null })).toBeUndefined()
    expect(labOgCard({ lab: null, stats: null })).toBeUndefined()
  })

  test("a lab shows its tokens and model count", () => {
    const card = labOgCard(thinkingMachines)
    expect(card).toMatchObject({ kind: "lab", path: "/data/thinkingmachines", name: "Thinking Machines", models: 3 })
    expect(card && ogImageAlt(card)).toBe(
      "Thinking Machines on OpenCode Data, with 358B tokens in the last 2 months across 3 models.",
    )
    const unused = labOgCard({ ...thinkingMachines, stats: null })
    expect(unused && ogImageAlt(unused)).toBe("Thinking Machines on OpenCode Data, with 3 models.")
  })
})

describe("image URL", () => {
  const card = modelOgCard(inkling)!

  test("is the English page's og.png with a version", () => {
    expect(ogImageUrl(card)).toBe(
      `https://opencode.ai/data/thinkingmachines/inkling-2-small/og.png?v=${ogVersion(card)}`,
    )
    expect(ogVersion(card)).toMatch(/^[0-9a-f]{8}$/)
  })

  test("changes when the card shows something new, or the day changes", () => {
    const version = ogVersion(card)
    expect(ogVersion({ ...card, rank: 19 })).not.toBe(version)
    expect(ogVersion({ ...card, tokens: 400_000_000_000 })).not.toBe(version)
    expect(ogVersion({ ...card, updatedAt: "2026-11-09T01:18:52.000Z" })).not.toBe(version)
  })

  test("stays put when the numbers move but the card doesn't", () => {
    const version = ogVersion(card)
    expect(ogVersion({ ...card, tokens: card.tokens + 1_000_000 })).toBe(version)
    expect(ogVersion({ ...card, updatedAt: "2026-11-08T22:05:00.000Z" })).toBe(version)
  })
})

describe("og.png response", () => {
  const card = modelOgCard(inkling)!
  // A dev stage's origin: its cache entries must not land on production's keys.
  const origin = "https://dev.opencode.ai"
  const image = `${card.path}/og.png`
  const banner = Bun.file(new URL("../public/banner.png", import.meta.url))

  // The first render compiles satori's, HarfBuzz's and resvg's Wasm in-process.
  test("renders a 1200x630 PNG with a long cache for the current version", async () => {
    const response = await ogResponse({
      origin,
      path: image,
      version: ogVersion(card),
      head: false,
      card: async () => card,
    })
    expect(response.headers.get("Content-Type")).toBe("image/png")
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
    )
    const png = new Uint8Array(await response.arrayBuffer())
    expect(Array.from(png.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const view = new DataView(png.buffer)
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([1200, 630])
  }, 30_000)

  test("any other version gets today's card with the pages' short cache, without a new render", async () => {
    const version = ogVersion(card)
    await ogResponse({ origin, path: image, version, head: false, card: async () => card })
    const before = renders.length
    for (const other of ["random-1", "random-2", "../x", null]) {
      const response = await ogResponse({ origin, path: image, version: other, head: true, card: async () => card })
      expect(response.headers.get("Content-Type")).toBe("image/png")
      expect(response.headers.get("Cache-Control")).toBe("public, max-age=60, s-maxage=300, must-revalidate")
      expect(response.body).toBeNull()
    }
    expect(renders.length).toBe(before)
    expect([...cached.keys()]).toEqual([`${origin}${image}?v=${version}`])
  }, 30_000)

  test("when a card fails to render, the banner stands in and is cached for a minute", async () => {
    const lab = labOgCard(thinkingMachines)!
    failing.add(lab.path)
    const before = renders.length
    for (const _ of [1, 2]) {
      const response = await ogResponse({
        origin,
        path: `${lab.path}/og.png`,
        version: ogVersion(lab),
        head: false,
        card: async () => lab,
      })
      expect(response.headers.get("Cache-Control")).toBe("public, max-age=60, s-maxage=60")
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(await banner.bytes())
    }
    // The second request is served from the cache, not another failed render.
    expect(renders.length).toBe(before + 1)
    expect(cached.has(`${origin}${lab.path}/og.png?v=${ogVersion(lab)}`)).toBe(true)
  })

  test("pages that don't exist or fail to load get the banner, uncached", async () => {
    const keys = cached.size
    for (const load of [async () => undefined, () => Promise.reject(new Error("PlanetScale is down"))]) {
      const response = await ogResponse({
        origin,
        path: "/data/nowhere/og.png",
        version: "abc",
        head: false,
        card: load,
      })
      expect(response.status).toBe(200)
      expect(response.headers.get("Content-Type")).toBe("image/png")
      expect(response.headers.get("Cache-Control")).toBe("public, max-age=60, s-maxage=60")
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(await banner.bytes())
    }
    expect(cached.size).toBe(keys)
  })
})

describe("OG Worker build", () => {
  // The deploy builds and uploads this; building it here fails the PR instead.
  test("bundles the Worker with the Wasm and font modules it imports", async () => {
    const out = path.join(tmpdir(), `stats-og-${process.pid}`)
    await buildOgWorker(out)
    const files = await readdir(out)
    const imports = [...(await Bun.file(path.join(out, "index.mjs")).text()).matchAll(/from"\.\/([\w.-]+)"/g)].map(
      (match) => match[1],
    )
    expect(imports.length).toBe(7)
    expect(files.toSorted()).toEqual(["index.mjs", ...imports].toSorted())
    await rm(out, { recursive: true, force: true })
  }, 30_000)
})
