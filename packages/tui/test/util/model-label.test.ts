import { expect, test } from "bun:test"
import { modelLabelKey, modelLabels, modelProviderName } from "../../src/util/model-label"

type Provider = { id: string; name: string; canonical?: string; integrationID?: string }
type Model = { providerID: string; id: string; name: string; status?: string }

function provider(
  id: string,
  name: string,
  options: { canonical?: string; integrationID?: string; models?: readonly (readonly [string, string])[] } = {},
) {
  return {
    provider: { id, name, canonical: options.canonical, integrationID: options.integrationID } satisfies Provider,
    models: (options.models ?? [["m", "Model"]]).map(([modelID, name]) => ({ providerID: id, id: modelID, name })),
  }
}

function catalog(...rows: ReturnType<typeof provider>[]) {
  return { providers: rows.map((row) => row.provider), models: rows.flatMap((row): Model[] => row.models) }
}

function label(input: ReturnType<typeof catalog>, providerID: string, modelID: string) {
  return modelLabels(input.providers, input.models).get(modelLabelKey(providerID, modelID))
}

const root = provider("opencode", "Anomaly / OpenCode", { integrationID: "opencode", models: [] })

const managed = provider("console-openai", "Anomaly / OpenAI", { integrationID: "opencode", canonical: "openai" })

test.each([
  provider("opencode", "Anomaly / OpenCode", { integrationID: "opencode" }),
  provider("opencode", "OpenCode"),
])("omits native provider $provider.name", (native) => {
  const all = catalog(native)

  expect(modelProviderName("opencode", all.providers)).toBeUndefined()
  expect(label(all, "opencode", "m")).toEqual({ provider: undefined, model: "Model" })
})

test("managed routes drop the workspace when the provider is not connected directly", () => {
  const all = catalog(root, managed)

  expect(label(all, managed.provider.id, "m")).toEqual({ provider: "OpenAI", model: "Model" })
})

test.each([
  { direct: provider("openai", "Renamed", { models: [] }), expected: "OpenCode / OpenAI" },
  { direct: provider("account", "Owls", { integrationID: "openai", models: [] }), expected: "OpenCode / OpenAI" },
  { direct: provider("proxy", "OpenAI", { canonical: "openai", models: [] }), expected: "OpenAI" },
  { direct: provider("azure", "Azure", { canonical: "openai" }), expected: "OpenAI" },
])("matches stable identities, not names or canonical proxies: $direct.provider.id", (row) => {
  const all = catalog(root, managed, row.direct)

  expect(modelProviderName(managed.provider.id, all.providers)).toBe(row.expected)
  expect(label(all, managed.provider.id, "m")).toEqual({ provider: row.expected, model: "Model" })
})

test("direct routes keep their own provider name", () => {
  const all = catalog(root, managed, provider("openai", "OpenAI", { models: [["luna", "GPT-6 Luna"]] }))

  expect(label(all, "openai", "luna")).toEqual({ provider: "OpenAI", model: "GPT-6 Luna" })
})

test("unknown managed routes do not infer identity from console prefixes or display names", () => {
  const all = catalog(
    root,
    provider("console-openai", "Anomaly / OpenAI", { integrationID: "opencode" }),
    provider("openai", "OpenAI"),
  )

  expect(modelProviderName("console-openai", all.providers)).toBe("OpenAI")
  expect(label(all, "console-openai", "m")).toEqual({ provider: "console-openai", model: "Model" })
})

test("duplicate provider labels use raw IDs only for overlapping model labels", () => {
  const all = catalog(
    provider("a", "OpenAI", {
      models: [
        ["m", "Model"],
        ["other", "Other"],
      ],
    }),
    provider("b", "OpenAI"),
  )

  expect(label(all, "a", "m")).toEqual({ provider: "a", model: "Model" })
  expect(label(all, "b", "m")).toEqual({ provider: "b", model: "Model" })
  expect(label(all, "a", "other")).toEqual({ provider: "OpenAI", model: "Other" })
})

test.each([
  { ids: ["gemini-4-argon", "gemini-4-argon-eap"], expected: ["Gemini", "Gemini (eap)"] },
  { ids: ["v1", "v2"], expected: ["Gemini (v1)", "Gemini (v2)"] },
  {
    ids: ["accounts/fireworks/models/glm", "accounts/fireworks/routers/glm-spot"],
    expected: ["Gemini (models/glm)", "Gemini (routers/glm-spot)"],
  },
])("same-route duplicate model names show only where their IDs differ: $ids", (row) => {
  const all = catalog(provider("google", "Google", { models: row.ids.map((id) => [id, "Gemini"] as const) }))

  expect(row.ids.map((id) => label(all, "google", id)?.model)).toEqual([...row.expected])
})

test("a peer group with provider and model duplicates needs both qualifiers", () => {
  const all = catalog(
    provider("a", "OpenAI", {
      models: [
        ["v1", "GPT"],
        ["v2", "GPT"],
      ],
    }),
    provider("b", "OpenAI", { models: [["m", "GPT"]] }),
  )

  expect(label(all, "a", "v1")).toEqual({ provider: "a", model: "GPT (v1)" })
  expect(label(all, "a", "v2")).toEqual({ provider: "a", model: "GPT (v2)" })
  expect(label(all, "b", "m")).toEqual({ provider: "b", model: "GPT" })
})

test("deprecated models neither get labels nor collide", () => {
  const all = catalog(
    provider("google", "Google", {
      models: [
        ["gemini-4", "Gemini"],
        ["gemini-4-old", "Gemini"],
      ],
    }),
  )
  const models = all.models.map((model) => (model.id === "gemini-4-old" ? { ...model, status: "deprecated" } : model))
  const labels = modelLabels(all.providers, models)

  expect(labels.get(modelLabelKey("google", "gemini-4"))).toEqual({ provider: "Google", model: "Gemini" })
  expect(labels.get(modelLabelKey("google", "gemini-4-old"))).toBeUndefined()
})

test("models without a listed provider get no label", () => {
  const labels = modelLabels([], [{ providerID: "gone", id: "m", name: "Model" }])

  expect(labels.size).toBe(0)
  expect(modelProviderName("gone", [])).toBe("gone")
})

test("drops the (latest) marker and keeps provider names verbatim", () => {
  const all = catalog(provider("custom", "  Custom / Proxy  ", { models: [["m", "GPT (latest)"]] }))

  expect(label(all, "custom", "m")).toEqual({ provider: "  Custom / Proxy  ", model: "GPT" })
})

test("tuple keys keep slash-containing provider and model identities separate", () => {
  const all = catalog(
    provider("company", "Company", { models: [["openai/gpt", "First model"]] }),
    provider("company/openai", "Other", { models: [["gpt", "Second model"]] }),
  )

  expect(modelLabelKey("company", "openai/gpt")).toBe('["company","openai/gpt"]')
  expect(modelLabels(all.providers, all.models).size).toBe(2)
  expect(label(all, "company", "openai/gpt")).toEqual({ provider: "Company", model: "First model" })
  expect(label(all, "company/openai", "gpt")).toEqual({ provider: "Other", model: "Second model" })
})
