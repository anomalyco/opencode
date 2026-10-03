import { expect, test } from "bun:test"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import type { Model } from "@/provider/provider"
import { ZenModels } from "@/provider/zen-models"

const BASE_URL = "https://opencode.ai/zen/v1"

function model(id: string, npm: string): Model {
  return {
    id: ModelV2.ID.make(id),
    providerID: ProviderV2.ID.opencode,
    name: id,
    family: id.startsWith("muse-spark") ? "muse-free" : "",
    api: {
      id,
      url: BASE_URL,
      npm,
    },
    status: "active",
    headers: {},
    options: {},
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 128000, output: 4096 },
    capabilities: {
      temperature: true,
      reasoning: true,
      attachment: true,
      toolcall: true,
      input: { text: true, audio: false, image: true, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: false,
    },
    release_date: "2026-08-05",
    variants: {},
  }
}

test("inferNpm keeps sibling catalog package for endpoint-only zen ids", () => {
  const existing = {
    "muse-spark-1.2-contributor-free": model("muse-spark-1.2-contributor-free", "@ai-sdk/openai"),
  }
  expect(ZenModels.inferNpm("muse-spark-1.3-contributor-free", existing)).toBe("@ai-sdk/openai")
})

test("inferNpm uses Responses package for muse-spark without a sibling", () => {
  expect(ZenModels.inferNpm("muse-spark-1.3-contributor-free", {})).toBe("@ai-sdk/openai")
})

test("merge does not collapse endpoint ids into empty openai-compatible entries", () => {
  const existing = {
    "muse-spark-1.2-contributor-free": model("muse-spark-1.2-contributor-free", "@ai-sdk/openai"),
  }
  const merged = ZenModels.merge(existing, [{ id: "muse-spark-1.3-contributor-free" }], BASE_URL)
  const discovered = merged["muse-spark-1.3-contributor-free"]

  expect(discovered).toBeDefined()
  expect(discovered.api).toEqual({
    id: "muse-spark-1.3-contributor-free",
    url: BASE_URL,
    npm: "@ai-sdk/openai",
  })
  expect(discovered.family).toBe("muse-free")
  expect(discovered.capabilities.toolcall).toBe(true)
  expect(merged["muse-spark-1.2-contributor-free"].api.npm).toBe("@ai-sdk/openai")
})

test("merge repairs collapsed empty-config entries that dropped transport metadata", () => {
  const collapsed = model("muse-spark-1.3-contributor-free", "@ai-sdk/openai-compatible")
  const merged = ZenModels.merge(
    {
      "muse-spark-1.2-contributor-free": model("muse-spark-1.2-contributor-free", "@ai-sdk/openai"),
      "muse-spark-1.3-contributor-free": collapsed,
    },
    [{ id: "muse-spark-1.3-contributor-free" }],
    BASE_URL,
  )

  expect(merged["muse-spark-1.3-contributor-free"].api.npm).toBe("@ai-sdk/openai")
})

test("merge keeps catalog package when the endpoint also sends npm", () => {
  const existing = {
    "gpt-5": model("gpt-5", "@ai-sdk/openai"),
  }
  const merged = ZenModels.merge(existing, [{ id: "gpt-5", npm: "@ai-sdk/openai" }], BASE_URL)
  expect(merged["gpt-5"].api.npm).toBe("@ai-sdk/openai")
})

test("get discovers zen models and retains per-model package metadata", async () => {
  const requests: Array<{ authorization: string | null; path: string }> = []
  using server = Bun.serve({
    port: 0,
    fetch(request) {
      requests.push({
        authorization: request.headers.get("authorization"),
        path: new URL(request.url).pathname,
      })
      return Response.json({
        object: "list",
        data: [
          { id: "muse-spark-1.2-contributor-free", object: "model" },
          { id: "muse-spark-1.3-contributor-free", object: "model" },
        ],
      })
    },
  })

  const models = await ZenModels.get(`${server.url}zen/v1`, "zen-key", {
    "muse-spark-1.2-contributor-free": model("muse-spark-1.2-contributor-free", "@ai-sdk/openai"),
  })

  expect(requests).toEqual([
    {
      authorization: "Bearer zen-key",
      path: "/zen/v1/models",
    },
  ])
  expect(models["muse-spark-1.3-contributor-free"].api.npm).toBe("@ai-sdk/openai")
  expect(models["muse-spark-1.2-contributor-free"].api.npm).toBe("@ai-sdk/openai")
})

test("get rejects when the zen models endpoint is unavailable", async () => {
  using server = Bun.serve({
    port: 0,
    fetch() {
      return new Response(null, { status: 503 })
    },
  })

  const existing = {
    "muse-spark-1.2-contributor-free": model("muse-spark-1.2-contributor-free", "@ai-sdk/openai"),
  }
  expect(await ZenModels.get(`${server.url}zen/v1`, "zen-key", existing).catch(() => ({}))).toEqual({})
})
