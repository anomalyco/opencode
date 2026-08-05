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

describe("parseRepository", () => {
  test("accepts repository IDs, hf URLs, and hf scheme references", () => {
    expect(parseRepository("org/model")).toBe("org/model")
    expect(parseRepository("https://huggingface.co/org/model/tree/main")).toBe("org/model")
    expect(parseRepository("hf://org/model")).toBe("org/model")
  })

  test("rejects incomplete repository IDs", () => {
    expect(() => parseRepository("model")).toThrow("Invalid Hugging Face repository")
  })
})
