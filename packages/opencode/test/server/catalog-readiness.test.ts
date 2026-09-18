import path from "node:path"
import { afterEach, describe, expect, test } from "bun:test"
import { Context } from "effect"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

const context = Context.empty() as Context.Context<unknown>
const delayedPlugin = path.join(import.meta.dir, "../../../core/test/fixture/delayed-catalog-plugin.ts")
const hangingPlugin = path.join(import.meta.dir, "../../../core/test/fixture/hanging-catalog-plugin.ts")

function request(route: string, directory: string) {
  const headers = new Headers()
  headers.set("x-opencode-directory", directory)
  return HttpApiApp.webHandler().handler(new Request(`http://localhost${route}`, { headers }), context)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("catalog readiness", () => {
  test("catalog reads wait for initial plugin activation", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            plugins: [delayedPlugin],
          }),
        )
      },
    })

    const [providers, models] = await Promise.all([
      request("/api/provider", tmp.path),
      request("/api/model", tmp.path),
    ])
    expect(providers.status).toBe(200)
    expect(models.status).toBe(200)

    const providerBody: unknown = await providers.json()
    const modelBody: unknown = await models.json()
    if (!isRecord(providerBody) || !Array.isArray(providerBody.data)) throw new Error("Expected a provider list")
    if (!isRecord(modelBody) || !Array.isArray(modelBody.data)) throw new Error("Expected a model list")

    expect(providerBody.data.some((provider) => isRecord(provider) && provider.id === "delayed-provider")).toBe(true)
    expect(
      modelBody.data.some(
        (model) => isRecord(model) && model.providerID === "delayed-provider" && model.id === "delayed-model",
      ),
    ).toBe(true)
  }, 15_000)

  test("catalog reads time out instead of returning a partial snapshot", async () => {
    await using tmp = await tmpdir({
      git: true,
      init: async (dir) => {
        await Bun.write(
          path.join(dir, "opencode.json"),
          JSON.stringify({
            plugins: [hangingPlugin],
          }),
        )
      },
    })

    const [providers, models] = await Promise.all([
      request("/api/provider", tmp.path),
      request("/api/model", tmp.path),
    ])
    expect(providers.status).toBe(503)
    expect(models.status).toBe(503)
  }, 15_000)
})
