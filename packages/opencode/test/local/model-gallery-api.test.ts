import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { loadCatalogCandidates } from "../../src/local/model-gallery/catalog"
import { GalleryEntry, GalleryHostInfo } from "../../src/server/routes/instance/httpapi/groups/gallery"
import type { ModelCandidate } from "../../src/local/model-catalog/types"

// The shared app/TUI surface (model-gallery-ui 5.7) and the candidate
// resolution behind it.

function candidate(over: Partial<ModelCandidate> = {}): ModelCandidate {
  return {
    id: "unsloth/Qwen3-32B-GGUF",
    name: "Qwen3-32B-GGUF",
    author: "unsloth",
    repository: "unsloth/Qwen3-32B-GGUF",
    revision: null,
    architecture: "qwen3",
    parameterCount: 32_000_000_000,
    activeParameterCount: null,
    trainedContext: 131072,
    pipelineTag: "text-generation",
    capabilities: ["tools"],
    languages: ["en"],
    license: "apache-2.0",
    downloads: 1000,
    likes: 10,
    tags: ["gguf"],
    variants: [],
    provenance: { source: "huggingface", freshness: "live" },
    policy: { allowed: true, reasons: [] },
    ...over,
  } as ModelCandidate
}

describe("candidate resolution (5.7 input)", () => {
  test("resolves each requested id", async () => {
    const got = await loadCatalogCandidates(["unsloth/Qwen3-32B-GGUF"], {
      resolve: async (repo) => candidate({ id: repo, repository: repo }),
      seed: () => [],
    })
    expect(got.map((c) => c.id)).toEqual(["unsloth/Qwen3-32B-GGUF"])
  })

  test("one unresolvable id does not empty the gallery", async () => {
    // A renamed or deleted repository among twenty is normal, not a reason to
    // show the user nothing.
    const got = await loadCatalogCandidates(["good/one", "gone/away", "good/two"], {
      resolve: async (repo) => {
        if (repo === "gone/away") throw new Error("404")
        return candidate({ id: repo, repository: repo })
      },
      seed: () => [],
    })
    expect(got.map((c) => c.id)).toEqual(["good/one", "good/two"])
  })

  test("falls back to the seed when live resolution fails", async () => {
    const got = await loadCatalogCandidates(["offline/model"], {
      resolve: async () => {
        throw new Error("network down")
      },
      seed: () => [candidate({ id: "offline/model", repository: "offline/model", provenance: { source: "seed", freshness: "seed" } })],
    })
    expect(got).toHaveLength(1)
    expect(got[0]!.provenance.source).toBe("seed")
  })

  test("duplicate ids collapse to one candidate", async () => {
    const got = await loadCatalogCandidates(["a/b", "a/b"], {
      resolve: async (repo) => candidate({ id: repo, repository: repo }),
      seed: () => [],
    })
    expect(got).toHaveLength(1)
  })

  test("an empty request does no work", async () => {
    let called = 0
    const got = await loadCatalogCandidates([], {
      resolve: async () => {
        called++
        return candidate()
      },
      seed: () => [],
    })
    expect(got).toEqual([])
    expect(called).toBe(0)
  })
})

describe("gallery API contract (5.7)", () => {
  const decodeEntry = Schema.decodeUnknownSync(GalleryEntry)
  const decodeHost = Schema.decodeUnknownSync(GalleryHostInfo)

  test("a host entry round-trips", () => {
    expect(() =>
      decodeHost({
        id: "http://m5:11435",
        name: "m5",
        baseURL: "http://m5:11435",
        source: "mdns",
        online: true,
        installedModelIDs: ["qwen3-32b"],
        defaultModel: "qwen3-32b",
      }),
    ).not.toThrow()
  })

  test("busy is optional, so unknown is representable and distinct from idle", () => {
    // An unreachable host must never serialize as busy:false — a client would
    // read that as free and dispatch into a hole.
    const base = {
      candidateId: "a/b",
      hostId: "http://m5:11435",
      hostName: "m5",
      online: true,
      installed: false,
      fitKnown: true,
      state: "fresh",
      stateDetail: "no qwen model on m5",
      compatible: true,
      incompatibleReasons: [],
      score: 42,
      components: [{ kind: "fit", points: 32, detail: "Q4_K_M fits m5 (good)", measured: true }],
      bestVariant: null,
      recommendedVariant: null,
      variants: [],
      vramFreeMB: 24000,
      vramTotalMB: 24576,
    }
    const withoutBusy = decodeEntry(base)
    expect(withoutBusy.busy).toBeUndefined()
    expect(decodeEntry({ ...base, busy: true }).busy).toBe(true)
  })

  test("the score breakdown is part of the contract, not a derived nicety", () => {
    // 5.5's whole point is that the UI can explain a ranking. If components
    // were dropped at the wire, every frontend would have to re-derive them
    // and would drift.
    const entry = decodeEntry({
      candidateId: "a/b",
      hostId: "h",
      hostName: "h",
      online: true,
      installed: false,
      fitKnown: false,
      state: "unknown",
      stateDetail: "h could not report fit",
      compatible: true,
      incompatibleReasons: [],
      score: 5,
      components: [
        { kind: "fit", points: 0, detail: "h could not report fit", measured: false },
        { kind: "popularity", points: 5, detail: "1000 downloads, 10 likes", measured: false },
      ],
      bestVariant: null,
      recommendedVariant: null,
      variants: [],
      vramFreeMB: 0,
      vramTotalMB: 0,
    })
    expect(entry.components).toHaveLength(2)
    expect(entry.score).toBe(entry.components.reduce((s, c) => s + c.points, 0))
  })

  test("incompatible entries carry their reasons so the UI can say why", () => {
    const entry = decodeEntry({
      candidateId: "a/b",
      hostId: "h",
      hostName: "h",
      online: false,
      installed: false,
      fitKnown: false,
      state: "offline",
      stateDetail: "h did not answer",
      compatible: false,
      incompatibleReasons: ["host-offline"],
      score: 0,
      components: [],
      bestVariant: null,
      recommendedVariant: null,
      variants: [],
      vramFreeMB: 0,
      vramTotalMB: 0,
    })
    expect(entry.incompatibleReasons).toEqual(["host-offline"])
  })
})
