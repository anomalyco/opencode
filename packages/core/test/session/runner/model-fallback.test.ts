import { describe, expect, test } from "bun:test"
import { DateTime } from "effect"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ProjectV2 } from "@opencode-ai/core/project"
import { SessionV2 } from "@opencode-ai/core/session"
import { ModelFallback } from "@opencode-ai/core/session/runner/model-fallback"

type Api =
  | { readonly type: "aisdk"; readonly package: string; readonly url?: string; readonly settings?: Record<string, unknown> }
  | { readonly type: "native"; readonly url?: string; readonly settings: Record<string, unknown> }

const makeModel = (providerID: string, id: string, released: number, api: Api = {
  type: "aisdk",
  package: "@ai-sdk/openai",
}) =>
  ModelV2.Info.make({
    id: ModelV2.ID.make(id as ModelV2.ID),
    providerID: ProviderV2.ID.make(providerID as ProviderV2.ID),
    name: id,
    api: { id: ModelV2.ID.make(id as ModelV2.ID), ...api },
    capabilities: { tools: true, input: ["text"], output: ["text"] },
    request: { headers: {}, body: { apiKey: "secret" } },
    variants: [],
    time: { released },
    cost: [],
    status: "active",
    enabled: true,
    limit: { context: 100, output: 20 },
  })

const makeSession = (model?: { providerID: string; id: string }) =>
  SessionV2.Info.make({
    id: SessionV2.ID.make("ses_fallback"),
    projectID: ProjectV2.ID.global,
    title: "fallback test",
    model: model
      ? {
          providerID: ProviderV2.ID.make(model.providerID as ProviderV2.ID),
          id: ModelV2.ID.make(model.id as ModelV2.ID),
        }
      : undefined,
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
    location: { directory: AbsolutePath.make("/project") },
  })

const openai = (id: string, released: number) => makeModel("alpha", id, released)
const anthropic = (id: string, released: number) =>
  makeModel("beta", id, released, { type: "aisdk", package: "@ai-sdk/anthropic" })
const unsupported = (id: string, released: number) =>
  makeModel("gamma", id, released, { type: "aisdk", package: "test-provider" })

describe("ModelFallback", () => {
  describe("order", () => {
    test("keeps supported models in release-descending order and drops unsupported ones", () => {
      const ordered = ModelFallback.order([
        unsupported("custom", 80),
        openai("gpt-4o-mini", 50),
        anthropic("claude-opus", 90),
        openai("gpt-4o", 100),
      ])
      expect(ordered.map((m) => m.name)).toEqual(["gpt-4o", "claude-opus", "gpt-4o-mini"])
    })
  })

  describe("chainFrom", () => {
    const available = [openai("gpt-4o", 100), anthropic("claude-opus", 90), openai("gpt-4o-mini", 50)]

    test("selects the session-chosen model as primary and orders alternatives release-desc", () => {
      const chain = ModelFallback.chainFrom(makeSession({ providerID: "alpha", id: "gpt-4o-mini" }), available)
      expect(chain.primary?.name).toBe("gpt-4o-mini")
      expect(chain.alternatives.map((m) => m.name)).toEqual(["gpt-4o", "claude-opus"])
    })

    test("falls back to the first supported model as primary when none is selected", () => {
      const chain = ModelFallback.chainFrom(makeSession(), available)
      expect(chain.primary?.name).toBe("gpt-4o")
      expect(chain.alternatives.map((m) => m.name)).toEqual(["claude-opus", "gpt-4o-mini"])
    })

    test("returns undefined primary and all alternatives when the session model is unavailable", () => {
      const chain = ModelFallback.chainFrom(makeSession({ providerID: "missing", id: "nope" }), available)
      expect(chain.primary).toBeUndefined()
      expect(chain.alternatives.map((m) => m.name)).toEqual(["gpt-4o", "claude-opus", "gpt-4o-mini"])
    })
  })

  describe("nextAlternative", () => {
    const chain = ModelFallback.chainFrom(
      makeSession({ providerID: "alpha", id: "gpt-4o-mini" }),
      [openai("gpt-4o", 100), anthropic("claude-opus", 90), openai("gpt-4o-mini", 50)],
    )

    test("advances through the alternatives, then exhausts", () => {
      const first = ModelFallback.nextAlternative(chain, chain.primary)
      expect(first?.name).toBe("gpt-4o")
      const second = ModelFallback.nextAlternative(chain, first)
      expect(second?.name).toBe("claude-opus")
      expect(ModelFallback.nextAlternative(chain, second)).toBeUndefined()
    })
  })
})