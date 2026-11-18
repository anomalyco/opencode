import { expect, test } from "bun:test"
import { composerModelLabelKey, composerModelLabels, composerProviderName } from "./model-label"

function provider(
  id: string,
  name: string,
  options: { canonical?: string; integrationID?: string; models?: readonly (readonly [string, string])[] } = {},
) {
  return {
    id,
    name,
    canonical: options.canonical,
    integrationID: options.integrationID,
    models: Object.fromEntries((options.models ?? [["m", "Model"]]).map(([id, name]) => [id, { id, name }])),
  }
}

function catalog(...providers: ReturnType<typeof provider>[]) {
  return new Map(providers.map((provider) => [provider.id, provider]))
}

function label(labels: ReturnType<typeof composerModelLabels>, providerID: string, modelID: string) {
  return labels.get(composerModelLabelKey(providerID, modelID))
}

const root = provider("opencode", "Anomaly / OpenCode", { integrationID: "opencode", models: [] })

const managed = provider("console-openai", "Anomaly / OpenAI", { integrationID: "opencode", canonical: "openai" })

test.each([
  provider("opencode", "Anomaly / OpenCode", { integrationID: "opencode" }),
  provider("opencode", "OpenCode"),
])("omits native provider $name", (native) => {
  const all = catalog(native)

  expect(composerProviderName("opencode", all)).toBeUndefined()
  expect(label(composerModelLabels(all), "opencode", "m")).toEqual({ provider: undefined, model: "Model" })
})

test.each([
  { direct: provider("openai", "Renamed", { models: [] }), connected: [], expected: "OpenAI" },
  { direct: provider("openai", "Renamed", { models: [] }), connected: ["openai"], expected: "OpenCode / OpenAI" },
  {
    direct: provider("account", "Owls", { integrationID: "openai", models: [] }),
    connected: ["account"],
    expected: "OpenCode / OpenAI",
  },
  {
    direct: provider("proxy", "OpenAI", { canonical: "openai", models: [] }),
    connected: ["proxy"],
    expected: "OpenAI",
  },
  { direct: provider("azure", "Azure", { canonical: "openai" }), connected: ["azure"], expected: "OpenAI" },
])("matches connected stable identities, not names or canonical proxies: $direct.id / $connected", (row) => {
  const all = catalog(root, managed, row.direct)

  expect(composerProviderName(managed.id, all, [managed.id, ...row.connected])).toBe(row.expected)
  expect(label(composerModelLabels(all, [managed.id, ...row.connected]), managed.id, "m")).toEqual({
    provider: row.expected,
    model: "Model",
  })
})

test("only connected providers get labels", () => {
  const labels = composerModelLabels(catalog(root, managed, provider("openai", "OpenAI")), [managed.id])

  expect(label(labels, managed.id, "m")).toEqual({ provider: "OpenAI", model: "Model" })
  expect(label(labels, "openai", "m")).toBeUndefined()
})

test("unknown managed routes do not infer identity from console prefixes or display names", () => {
  const all = catalog(
    root,
    provider("console-openai", "Anomaly / OpenAI", { integrationID: "opencode" }),
    provider("openai", "OpenAI"),
  )

  expect(composerProviderName("console-openai", all)).toBe("OpenAI")
  expect(label(composerModelLabels(all), "console-openai", "m")).toEqual({ provider: "console-openai", model: "Model" })
})

test("duplicate provider labels use raw IDs only for overlapping model labels", () => {
  const labels = composerModelLabels(
    catalog(
      provider("a", "OpenAI", {
        models: [
          ["m", "Model"],
          ["other", "Other"],
        ],
      }),
      provider("b", "OpenAI"),
    ),
  )

  expect(label(labels, "a", "m")).toEqual({ provider: "a", model: "Model" })
  expect(label(labels, "b", "m")).toEqual({ provider: "b", model: "Model" })
  expect(label(labels, "a", "other")).toEqual({ provider: "OpenAI", model: "Other" })
})

test.each([
  { ids: ["gemini-4-argon", "gemini-4-argon-eap"], expected: ["Gemini", "Gemini (eap)"] },
  { ids: ["v1", "v2"], expected: ["Gemini (v1)", "Gemini (v2)"] },
  {
    ids: ["accounts/fireworks/models/glm", "accounts/fireworks/routers/glm-spot"],
    expected: ["Gemini (models/glm)", "Gemini (routers/glm-spot)"],
  },
])("same-route duplicate model names show only where their IDs differ: $ids", (row) => {
  const labels = composerModelLabels(
    catalog(provider("google", "Google", { models: row.ids.map((id) => [id, "Gemini"] as const) })),
  )

  expect(row.ids.map((id) => label(labels, "google", id)?.model)).toEqual([...row.expected])
})

test("a peer group with provider and model duplicates needs both qualifiers", () => {
  const labels = composerModelLabels(
    catalog(
      provider("a", "OpenAI", {
        models: [
          ["v1", "GPT"],
          ["v2", "GPT"],
        ],
      }),
      provider("b", "OpenAI", { models: [["m", "GPT"]] }),
    ),
  )

  expect(label(labels, "a", "v1")).toEqual({ provider: "a", model: "GPT (v1)" })
  expect(label(labels, "a", "v2")).toEqual({ provider: "a", model: "GPT (v2)" })
  expect(label(labels, "b", "m")).toEqual({ provider: "b", model: "GPT" })
})

test("drops the (latest) marker and keeps provider names verbatim", () => {
  const all = catalog(provider("custom", "  Custom / Proxy  ", { models: [["m", "GPT (latest)"]] }))

  expect(label(composerModelLabels(all), "custom", "m")).toEqual({ provider: "  Custom / Proxy  ", model: "GPT" })
})

test("tuple keys keep slash-containing provider and model identities separate", () => {
  const labels = composerModelLabels(
    catalog(
      provider("company", "Company", { models: [["openai/gpt", "First model"]] }),
      provider("company/openai", "Other", { models: [["gpt", "Second model"]] }),
    ),
  )

  expect(composerModelLabelKey("company", "openai/gpt")).toBe('["company","openai/gpt"]')
  expect(labels.size).toBe(2)
  expect(label(labels, "company", "openai/gpt")).toEqual({ provider: "Company", model: "First model" })
  expect(label(labels, "company/openai", "gpt")).toEqual({ provider: "Other", model: "Second model" })
})
