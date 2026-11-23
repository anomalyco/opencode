import { describe, expect, test } from "bun:test"
import { hasConnectedProvider } from "../../src/util/connected-provider"

const opencode = { providerID: "opencode", status: "active" } as const
const ollama = { providerID: "ollama", status: "active" } as const
const providers = [{ id: "opencode" }, { id: "ollama" }]

describe("hasConnectedProvider", () => {
  test.each<[string, Parameters<typeof hasConnectedProvider>[0], boolean]>([
    ["nothing listed", { integrations: [], providers: [], models: [] }, false],
    ["only OpenCode's keyless models", { integrations: [{ connections: [] }], providers, models: [opencode] }, false],
    [
      "a stored credential",
      {
        integrations: [
          {
            connections: [
              {
                type: "credential",
                method: "key",
                id: "cred_1",
                label: "Work",
              },
            ],
          },
        ],
        providers: [],
        models: [],
      },
      true,
    ],
    [
      "a detected environment variable",
      {
        integrations: [{ connections: [{ type: "env", name: "OPENAI_API_KEY" }] }],
        providers: [],
        models: [],
      },
      true,
    ],
    ["a provider declared only in config", { integrations: [], providers, models: [opencode, ollama] }, true],
    [
      "only deprecated models",
      {
        integrations: [],
        providers,
        models: [{ ...ollama, status: "deprecated" }],
      },
      false,
    ],
    [
      "models of a provider that is not listed",
      { integrations: [], providers: [{ id: "opencode" }], models: [ollama] },
      false,
    ],
  ])("%s", (_, input, expected) => {
    expect(hasConnectedProvider(input)).toBe(expected)
  })
})
