import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Provider } from "../src/provider"

// Configs and models.dev name these packages, so each must keep loading and building a model from flat settings.
const settings = [
  {
    apiKey: "test",
    baseURL: "https://example.test/v1",
    region: "us-east-1",
    project: "project",
    location: "us-central1",
  },
  { accessToken: "test", project: "project", location: "us-central1" },
  { apiKey: "test", accountId: "account", gatewayId: "gateway" },
]

describe("native provider packages", () => {
  test.each([...Provider.builtinPackages].sort())("%s builds a model", async (name) => {
    const module = await Effect.runPromise(Provider.loadPackage(name))
    const built = settings.flatMap((input) => {
      try {
        return [module.model("test-model", input)]
      } catch {
        return []
      }
    })
    expect(built[0]).toMatchObject({ id: "test-model" })
  })
})
