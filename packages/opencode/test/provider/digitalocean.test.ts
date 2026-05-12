import { test, expect, afterEach } from "bun:test"
import path from "path"

import { tmpdir } from "../fixture/fixture"
import { WithInstance } from "../../src/project/with-instance"
import { Provider } from "../../src/provider/provider"
import { ProviderID } from "../../src/provider/schema"
import { Env } from "../../src/env"
import { Effect } from "effect"
import { AppRuntime } from "../../src/effect/app-runtime"
import { makeRuntime } from "../../src/effect/run-service"

const envRuntime = makeRuntime(Env.Service, Env.defaultLayer)
const set = (k: string, v: string) => envRuntime.runSync((svc) => svc.set(k, v))

async function list() {
  return AppRuntime.runPromise(
    Effect.gen(function* () {
      const provider = yield* Provider.Service
      return yield* provider.list()
    }),
  )
}

const DIGITALOCEAN = ProviderID.make("digitalocean")

const originalAuthContent = process.env.OPENCODE_AUTH_CONTENT
afterEach(() => {
  if (originalAuthContent === undefined) delete process.env.OPENCODE_AUTH_CONTENT
  else process.env.OPENCODE_AUTH_CONTENT = originalAuthContent
})

function injectAuth(metadata: Record<string, string> | undefined) {
  process.env.OPENCODE_AUTH_CONTENT = JSON.stringify({
    digitalocean: {
      type: "api",
      key: "sk_do_test",
      ...(metadata ? { metadata } : {}),
    },
  })
}

test("digitalocean provider autoloads from DIGITALOCEAN_ACCESS_TOKEN", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({ $schema: "https://opencode.ai/config.json" }),
      )
    },
  })
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      set("DIGITALOCEAN_ACCESS_TOKEN", "test-token")
      const providers = await list()
      expect(providers[DIGITALOCEAN]).toBeDefined()
      expect(providers[DIGITALOCEAN].source).toBe("env")
      const baseModel = Object.values(providers[DIGITALOCEAN].models)[0]
      expect(baseModel.api.url).toBe("https://inference.do-ai.run/v1")
      expect(baseModel.api.npm).toBe("@ai-sdk/openai-compatible")
      const routerEntries = Object.keys(providers[DIGITALOCEAN].models).filter((id) => id.startsWith("router:"))
      expect(routerEntries.length).toBe(0)
    },
  })
})

test("digitalocean provider.models surfaces cached routers from auth metadata", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({ $schema: "https://opencode.ai/config.json" }),
      )
    },
  })
  injectAuth({
    routers: JSON.stringify([
      { name: "my-router", uuid: "11f1499a-aaaa-bbbb-cccc-4e013e2ddde4" },
      { name: "other-router", uuid: "22f1499a-aaaa-bbbb-cccc-4e013e2ddde4" },
    ]),
    routers_fetched_at: String(Date.now()),
    oauth_access: "doo_v1_test",
    oauth_expires: String(Date.now() + 60 * 60 * 1000),
  })
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const providers = await list()
      const models = providers[DIGITALOCEAN].models
      expect(models["router:my-router"]).toBeDefined()
      expect(models["router:my-router"].api.id).toBe("router:my-router")
      expect(models["router:my-router"].api.url).toBe("https://inference.do-ai.run/v1")
      expect(models["router:my-router"].api.npm).toBe("@ai-sdk/openai-compatible")
      expect(models["router:other-router"]).toBeDefined()
    },
  })
})

test("digitalocean provider.models skips refresh when oauth bearer is expired", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({ $schema: "https://opencode.ai/config.json" }),
      )
    },
  })
  injectAuth({
    routers: JSON.stringify([{ name: "stale-router", uuid: "stale" }]),
    routers_fetched_at: "0",
    oauth_access: "doo_v1_expired",
    oauth_expires: "1",
  })
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const providers = await list()
      const models = providers[DIGITALOCEAN].models
      expect(models["router:stale-router"]).toBeDefined()
    },
  })
})

test("digitalocean provider.models passes through base models when no auth metadata", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({ $schema: "https://opencode.ai/config.json" }),
      )
    },
  })
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      set("DIGITALOCEAN_ACCESS_TOKEN", "test-token")
      const providers = await list()
      const models = providers[DIGITALOCEAN].models
      expect(Object.keys(models).length).toBeGreaterThan(0)
      expect(Object.keys(models).filter((id) => id.startsWith("router:")).length).toBe(0)
    },
  })
})
