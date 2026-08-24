import { afterEach, describe, expect, test } from "bun:test"
import { createHuggingFaceCatalog, parseRepository } from "../../src/local/model-catalog/huggingface"

let server: ReturnType<typeof Bun.serve> | undefined

afterEach(() => {
  server?.stop(true)
  server = undefined
})

function serve(handler: (request: Request) => Response | Promise<Response>) {
  server = Bun.serve({ port: 0, fetch: handler })
  return server.url.toString().replace(/\/$/, "")
}

describe("Hugging Face catalog search", () => {
  test("bounds search and keeps immutable provenance", async () => {
    const endpoint = serve((request) => {
      const url = new URL(request.url)
      expect(url.pathname).toBe("/api/models")
      expect(url.searchParams.get("search")).toBe("qwen coder gguf")
      expect(url.searchParams.get("sort")).toBe("downloads")
      expect(url.searchParams.get("direction")).toBe("-1")
      expect(url.searchParams.get("limit")).toBe("100")
      return Response.json([
        {
          id: "org/Qwen-Coder-GGUF",
          author: "org",
          sha: "abc123",
          downloads: 42,
          likes: 7,
          tags: ["gguf", "text-generation", "license:apache-2.0", "function-calling"],
          pipeline_tag: "text-generation",
          siblings: [{ rfilename: "Qwen-Coder-Q4_K_M.gguf" }],
        },
        {
          id: "org/not-gguf",
          tags: ["safetensors"],
        },
      ])
    })

    const result = await createHuggingFaceCatalog({ endpoint }).search({ query: "qwen coder", limit: 500 })

    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]).toMatchObject({
      repository: "org/Qwen-Coder-GGUF",
      revision: "abc123",
      license: "apache-2.0",
      capabilities: ["chat", "tool_use"],
      policy: { allowed: true, reasons: [] },
      provenance: {
        source: "huggingface",
        revision: "abc123",
        freshness: "live",
      },
    })
  })

  test("uses top GGUF discovery for an empty query", async () => {
    const endpoint = serve((request) => {
      expect(new URL(request.url).searchParams.get("search")).toBe("gguf")
      return Response.json([])
    })

    await expect(createHuggingFaceCatalog({ endpoint }).search()).resolves.toEqual({
      query: "",
      candidates: [],
    })
  })
})

describe("Hugging Face repository resolution", () => {
  test("pins the current revision and groups complete GGUF shards", async () => {
    const endpoint = serve((request) => {
      const url = new URL(request.url)
      if (url.pathname === "/api/models/org/model-GGUF") {
        return Response.json({ id: "org/model-GGUF", sha: "deadbeef" })
      }
      expect(url.pathname).toBe("/api/models/org/model-GGUF/revision/deadbeef")
      expect(url.searchParams.get("blobs")).toBe("true")
      return Response.json({
        id: "org/model-GGUF",
        author: "org",
        sha: "deadbeef",
        tags: ["gguf", "license:mit"],
        gguf: { architecture: "qwen3moe", context_length: 131072, total: 30532122624 },
        siblings: [
          {
            rfilename: "model-Q4_K_M-00001-of-00002.gguf",
            lfs: { size: 100, sha256: "aaa" },
          },
          {
            rfilename: "model-Q4_K_M-00002-of-00002.gguf",
            lfs: { size: 120, sha256: "bbb" },
          },
          {
            rfilename: "model-Q8_0.gguf",
            lfs: { size: 400, sha256: "ccc" },
          },
          {
            rfilename: "mmproj-model-f16.gguf",
            lfs: { size: 10, sha256: "ddd" },
          },
        ],
      })
    })

    const candidate = await createHuggingFaceCatalog({ endpoint }).resolve({
      repository: "https://huggingface.co/org/model-GGUF",
    })

    expect(candidate).toMatchObject({
      repository: "org/model-GGUF",
      revision: "deadbeef",
      architecture: "qwen3moe",
      parameterCount: 30532122624,
      trainedContext: 131072,
      license: "mit",
    })
    expect(candidate.variants).toHaveLength(2)
    expect(candidate.variants.map((variant) => variant.quantization)).toEqual(["Q4_K_M", "Q8_0"])
    // The shared mmproj file is attached to every quantization, not dropped or grouped as its own shard set.
    expect(candidate.variants[0]).toMatchObject({
      totalBytes: 230,
      complete: true,
      artifacts: [
        { digest: "sha256:aaa", role: "weights", size: 100 },
        { digest: "sha256:bbb", role: "weights", size: 120 },
        { digest: "sha256:ddd", role: "projection", size: 10 },
      ],
    })
    expect(candidate.variants[1]).toMatchObject({
      totalBytes: 410,
      artifacts: [
        { digest: "sha256:ccc", role: "weights", size: 400 },
        { digest: "sha256:ddd", role: "projection", size: 10 },
      ],
    })
    expect(candidate.variants[0].artifacts[0].downloadURL).toBe(
      `${endpoint}/org/model-GGUF/resolve/deadbeef/model-Q4_K_M-00001-of-00002.gguf`,
    )
    expect(candidate.variants[0].artifacts[2].downloadURL).toBe(
      `${endpoint}/org/model-GGUF/resolve/deadbeef/mmproj-model-f16.gguf`,
    )
  })

  test("derives active parameters from config expert counts, not the gguf block", async () => {
    const endpoint = serve(() =>
      Response.json({
        id: "org/moe-GGUF",
        sha: "deadbeef",
        tags: ["gguf"],
        gguf: { architecture: "qwen3moe", total: 30_500_000_000 },
        config: { num_experts: 128, num_experts_per_tok: 8 },
        siblings: [{ rfilename: "moe-Q4_K_M.gguf", lfs: { size: 100, sha256: "aaa" } }],
      }),
    )

    const candidate = await createHuggingFaceCatalog({ endpoint }).resolve({
      repository: "org/moe-GGUF",
      revision: "deadbeef",
    })

    expect(candidate.parameterCount).toBe(30_500_000_000)
    expect(candidate.activeParameterCount).toBe(1_906_250_000)
  })

  test("leaves active parameters unresolved for dense models without expert counts", async () => {
    const endpoint = serve(() =>
      Response.json({
        id: "org/dense-GGUF",
        sha: "deadbeef",
        tags: ["gguf"],
        gguf: { architecture: "qwen2", total: 7_615_616_512 },
        siblings: [{ rfilename: "dense-Q4_K_M.gguf", lfs: { size: 100, sha256: "aaa" } }],
      }),
    )

    const candidate = await createHuggingFaceCatalog({ endpoint }).resolve({
      repository: "org/dense-GGUF",
      revision: "deadbeef",
    })

    expect(candidate.parameterCount).toBe(7_615_616_512)
    expect(candidate.activeParameterCount).toBeNull()
  })

  test("retains incomplete shard sets for later policy filtering", async () => {
    const endpoint = serve(() =>
      Response.json({
        id: "org/model-GGUF",
        sha: "deadbeef",
        tags: ["gguf"],
        siblings: [
          {
            rfilename: "model-Q6_K-00001-of-00002.gguf",
            lfs: { size: 100, sha256: "aaa" },
          },
        ],
      }),
    )

    const candidate = await createHuggingFaceCatalog({ endpoint }).resolve({
      repository: "org/model-GGUF",
      revision: "deadbeef",
    })

    expect(candidate.variants).toHaveLength(1)
    expect(candidate.variants[0].complete).toBe(false)
    expect(candidate.policy).toEqual({
      allowed: false,
      reasons: [
        "license is unavailable",
        "1 of 1 shard set(s) are incomplete",
        "no complete GGUF artifact set is available",
      ],
    })
  })
})

describe("Hugging Face policy filters", () => {
  test("blocks gated, private, and disabled repositories before any variant is resolved", async () => {
    const endpoint = serve((request) => {
      const url = new URL(request.url)
      if (url.pathname === "/api/models/org/blocked-GGUF") return Response.json({ sha: "deadbeef" })
      return Response.json({
        id: "org/blocked-GGUF",
        sha: "deadbeef",
        gated: "manual",
        private: true,
        disabled: true,
        tags: ["safetensors"],
        cardData: { license: "mit" },
      })
    })

    const candidate = await createHuggingFaceCatalog({ endpoint }).resolve({ repository: "org/blocked-GGUF" })

    expect(candidate.policy).toEqual({
      allowed: false,
      reasons: [
        "repository is private",
        "repository requires Hugging Face gated access approval",
        "repository is disabled",
        "no supported model format (GGUF) found",
      ],
    })
  })

  test("stays allowed when at least one variant is a complete shard set", async () => {
    const endpoint = serve(() =>
      Response.json({
        id: "org/mixed-GGUF",
        sha: "deadbeef",
        tags: ["gguf"],
        cardData: { license: "mit" },
        siblings: [
          { rfilename: "model-Q4_K_M.gguf", lfs: { size: 100, sha256: "aaa" } },
          { rfilename: "model-Q6_K-00001-of-00002.gguf", lfs: { size: 100, sha256: "bbb" } },
        ],
      }),
    )

    const candidate = await createHuggingFaceCatalog({ endpoint }).resolve({
      repository: "org/mixed-GGUF",
      revision: "deadbeef",
    })

    expect(candidate.policy).toEqual({
      allowed: true,
      reasons: ["1 of 2 shard set(s) are incomplete"],
    })
  })
})

describe("Hugging Face file-info cases", () => {
  test("prefers the LFS size and sha256 digest when present", async () => {
    const endpoint = serve(() =>
      Response.json({
        id: "org/model-GGUF",
        sha: "deadbeef",
        tags: ["gguf"],
        siblings: [{ rfilename: "model-Q4_K_M.gguf", size: 1, lfs: { size: 999, sha256: "aaa" } }],
      }),
    )
    const candidate = await createHuggingFaceCatalog({ endpoint }).resolve({
      repository: "org/model-GGUF",
      revision: "deadbeef",
    })
    // The plain `size` field is what the Hub reports for non-LFS storage; `lfs.size`
    // is the real file size for LFS-tracked weights and must win when both are present.
    expect(candidate.variants[0].artifacts[0]).toMatchObject({ size: 999, digest: "sha256:aaa" })
  })

  test("falls back to the plain size field for a non-LFS file", async () => {
    const endpoint = serve(() =>
      Response.json({
        id: "org/model-GGUF",
        sha: "deadbeef",
        tags: ["gguf"],
        siblings: [{ rfilename: "model-Q4_K_M.gguf", size: 500 }],
      }),
    )
    const candidate = await createHuggingFaceCatalog({ endpoint }).resolve({
      repository: "org/model-GGUF",
      revision: "deadbeef",
    })
    expect(candidate.variants[0].artifacts[0]).toMatchObject({ size: 500, digest: null })
  })

  test("KNOWN GAP: a non-LFS file's blobId is accepted by the schema but never surfaced as a digest", async () => {
    // GGUF weights are always LFS-tracked in practice, so this has never been
    // observed to matter for a real model. It is pinned here, not fixed, because
    // fixing it means deciding whether ModelArtifact.digest should accept a git
    // blob SHA-1 as a weaker-than-sha256 fallback — a type-level decision with
    // consumers beyond this file, not something to change while writing cases.
    const endpoint = serve(() =>
      Response.json({
        id: "org/model-GGUF",
        sha: "deadbeef",
        tags: ["gguf"],
        siblings: [{ rfilename: "model-Q4_K_M.gguf", size: 500, blobId: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4" }],
      }),
    )
    const candidate = await createHuggingFaceCatalog({ endpoint }).resolve({
      repository: "org/model-GGUF",
      revision: "deadbeef",
    })
    expect(candidate.variants[0].artifacts[0].digest).toBeNull()
  })

  test("missing size on both fields leaves the artifact size null and the variant untotalled", async () => {
    const endpoint = serve(() =>
      Response.json({
        id: "org/model-GGUF",
        sha: "deadbeef",
        tags: ["gguf"],
        siblings: [{ rfilename: "model-Q4_K_M.gguf" }],
      }),
    )
    const candidate = await createHuggingFaceCatalog({ endpoint }).resolve({
      repository: "org/model-GGUF",
      revision: "deadbeef",
    })
    expect(candidate.variants[0].artifacts[0].size).toBeNull()
    // One artifact with an unknown size must poison the whole variant's total,
    // not silently report a total that is short by an unknown amount.
    expect(candidate.variants[0].totalBytes).toBeNull()
  })
})

describe("Hugging Face nested-path cases", () => {
  test("groups, sizes, and builds correct URLs for weights stored under a subdirectory", async () => {
    const endpoint = serve(() =>
      Response.json({
        id: "org/model-GGUF",
        sha: "deadbeef",
        tags: ["gguf"],
        siblings: [
          { rfilename: "gguf/model-Q4_K_M-00001-of-00002.gguf", lfs: { size: 100, sha256: "aaa" } },
          { rfilename: "gguf/model-Q4_K_M-00002-of-00002.gguf", lfs: { size: 120, sha256: "bbb" } },
        ],
      }),
    )
    const candidate = await createHuggingFaceCatalog({ endpoint }).resolve({
      repository: "org/model-GGUF",
      revision: "deadbeef",
    })
    expect(candidate.variants).toHaveLength(1)
    expect(candidate.variants[0]).toMatchObject({ quantization: "Q4_K_M", complete: true, totalBytes: 220 })
    // Each path segment is percent-encoded independently — the "/" between
    // "gguf" and the filename must stay a literal separator, not become %2F.
    expect(candidate.variants[0].artifacts[0].downloadURL).toBe(
      `${endpoint}/org/model-GGUF/resolve/deadbeef/gguf/model-Q4_K_M-00001-of-00002.gguf`,
    )
  })

  test("a projector nested under its own subdirectory is still recognised and attached to every variant", async () => {
    const endpoint = serve(() =>
      Response.json({
        id: "org/model-GGUF",
        sha: "deadbeef",
        tags: ["gguf"],
        siblings: [
          { rfilename: "model-Q4_K_M.gguf", lfs: { size: 100, sha256: "aaa" } },
          { rfilename: "vision/mmproj-f16.gguf", lfs: { size: 10, sha256: "bbb" } },
        ],
      }),
    )
    const candidate = await createHuggingFaceCatalog({ endpoint }).resolve({
      repository: "org/model-GGUF",
      revision: "deadbeef",
    })
    expect(candidate.variants[0].artifacts).toHaveLength(2)
    expect(candidate.variants[0].artifacts.find((a) => a.role === "projection")?.path).toBe("vision/mmproj-f16.gguf")
  })
})

describe("Hugging Face gated-repository cases", () => {
  test("boolean gated:true blocks the repository, same as the string form", async () => {
    const endpoint = serve(() =>
      Response.json({
        id: "org/gated-GGUF",
        sha: "deadbeef",
        gated: true,
        tags: ["gguf"],
        cardData: { license: "mit" },
        siblings: [{ rfilename: "model-Q4_K_M.gguf", lfs: { size: 100, sha256: "aaa" } }],
      }),
    )
    const candidate = await createHuggingFaceCatalog({ endpoint }).resolve({
      repository: "org/gated-GGUF",
      revision: "deadbeef",
    })
    expect(candidate.policy).toEqual({
      allowed: false,
      reasons: ["repository requires Hugging Face gated access approval"],
    })
  })

  test("gated:false is not gated", async () => {
    const endpoint = serve(() =>
      Response.json({
        id: "org/open-GGUF",
        sha: "deadbeef",
        gated: false,
        tags: ["gguf"],
        cardData: { license: "mit" },
        siblings: [{ rfilename: "model-Q4_K_M.gguf", lfs: { size: 100, sha256: "aaa" } }],
      }),
    )
    const candidate = await createHuggingFaceCatalog({ endpoint }).resolve({
      repository: "org/open-GGUF",
      revision: "deadbeef",
    })
    expect(candidate.policy).toEqual({ allowed: true, reasons: [] })
  })

  test("a gated repository still resolves its variants — gating blocks policy, not resolution", async () => {
    const endpoint = serve(() =>
      Response.json({
        id: "org/gated-GGUF",
        sha: "deadbeef",
        gated: "manual",
        tags: ["gguf"],
        siblings: [{ rfilename: "model-Q4_K_M.gguf", lfs: { size: 100, sha256: "aaa" } }],
      }),
    )
    const candidate = await createHuggingFaceCatalog({ endpoint }).resolve({
      repository: "org/gated-GGUF",
      revision: "deadbeef",
    })
    expect(candidate.variants).toHaveLength(1)
    expect(candidate.policy.allowed).toBe(false)
    expect(candidate.policy.reasons).toContain("repository requires Hugging Face gated access approval")
  })
})

describe("parseRepository", () => {
  test("accepts repository IDs, hf URLs, and hf scheme references", () => {
    expect(parseRepository("org/model")).toBe("org/model")
    expect(parseRepository("https://huggingface.co/org/model/tree/main")).toBe("org/model")
    expect(parseRepository("hf://org/model")).toBe("org/model")
    // The scheme match is case-insensitive and a trailing slash is tolerated.
    expect(parseRepository("HF://org/model")).toBe("org/model")
    expect(parseRepository("org/model/")).toBe("org/model")
  })

  test("strips a .git suffix from the repository name", () => {
    expect(parseRepository("https://huggingface.co/org/model.git")).toBe("org/model")
  })

  test("ignores path segments beyond org/name, such as a branch, tag, or PR ref", () => {
    expect(parseRepository("https://huggingface.co/org/model/tree/main")).toBe("org/model")
    expect(parseRepository("https://huggingface.co/org/model/tree/refs%2Fpr%2F3")).toBe("org/model")
  })

  test("rejects incomplete repository IDs", () => {
    expect(() => parseRepository("model")).toThrow("Invalid Hugging Face repository")
  })

  test("rejects an empty reference", () => {
    expect(() => parseRepository("")).toThrow("Invalid Hugging Face repository")
  })

  test("rejects Spaces, Datasets, and other non-model Hugging Face URLs instead of misreading the resource type as an org", () => {
    expect(() => parseRepository("https://huggingface.co/spaces/foo/bar")).toThrow(/not a model/)
    expect(() => parseRepository("https://huggingface.co/datasets/foo/bar")).toThrow(/not a model/)
    expect(() => parseRepository("https://huggingface.co/papers/2401.12345")).toThrow(/not a model/)
  })

  test("an explicit /models/ prefix is still accepted", () => {
    expect(parseRepository("https://huggingface.co/models/org/model")).toBe("org/model")
  })
})
