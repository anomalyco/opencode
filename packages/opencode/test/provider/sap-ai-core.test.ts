import { test, expect, describe } from "bun:test"
import { Provider } from "../../src/provider/provider"
import { Instance } from "../../src/project/instance"
import { Config } from "../../src/config/config"
import { tmpdir } from "../fixture/fixture"

function setEnv(vars: Record<string, string | undefined>) {
  const originals: Record<string, string | undefined> = {}
  for (const [k, v] of Object.entries(vars)) {
    originals[k] = process.env[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  return () => {
    for (const [k, v] of Object.entries(originals)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

async function withProviderConfig(models?: any) {
  const modelBlock = models ?? { test: { id: "real-deploy" } }
  await Config.update({ provider: { "sap-ai-core": { models: modelBlock } } } as any)
}

describe("sap-ai-core provider", () => {
  test("does not autoload without credentials", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await withProviderConfig()
        const restore = setEnv({
          SAP_AI_CORE_URL: undefined,
          SAP_AI_CORE_CLIENT_ID: undefined,
          SAP_AI_CORE_CLIENT_SECRET: undefined,
          SAP_AI_CORE_OAUTH_URL: undefined,
          SAP_AI_CORE_SERVICE_KEY: undefined,
        })
        try {
          const list = await Provider.list()
          // Provider exists because config defines it, but fetch option should be absent (no autoload merge)
          const prov = list["sap-ai-core"]
          expect(prov.options.fetch).toBeUndefined()
        } finally {
          restore()
        }
      },
    })
  })

  test("autoloads with discrete env vars and provides fetch", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await withProviderConfig()
        const restore = setEnv({
          SAP_AI_CORE_URL: "https://api.example.com",
          SAP_AI_CORE_CLIENT_ID: "id",
          SAP_AI_CORE_CLIENT_SECRET: "secret",
          SAP_AI_CORE_OAUTH_URL: "https://auth.example.com/oauth/token",
        })
        const originalFetch = globalThis.fetch
        let tokenCalls = 0
        globalThis.fetch = Object.assign(
          async (input: RequestInfo, init?: RequestInit) => {
            const url = String(input)
            if (url.includes("auth.example.com")) {
              tokenCalls++
              return new Response(JSON.stringify({ access_token: "t1", expires_in: 120 }), { status: 200 })
            }
            return new Response("ok", { status: 200 })
          },
          { preconnect: () => {} },
        ) as typeof fetch
        try {
          const prov = await Provider.getProvider("sap-ai-core")
          expect(prov.options.fetch).toBeDefined()
          const res1 = await prov.options.fetch!("https://api.example.com/infer")
          expect(res1.status).toBe(200)
          expect(tokenCalls).toBe(1)
          const res2 = await prov.options.fetch!("https://api.example.com/infer")
          expect(res2.status).toBe(200)
          expect(tokenCalls).toBe(1) // cached
        } finally {
          globalThis.fetch = originalFetch
          restore()
        }
      },
    })
  })

  test("refreshes token when near expiry (jitter)", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await withProviderConfig()
        const restore = setEnv({
          SAP_AI_CORE_URL: "https://api.example.com",
          SAP_AI_CORE_CLIENT_ID: "id",
          SAP_AI_CORE_CLIENT_SECRET: "secret",
          SAP_AI_CORE_OAUTH_URL: "https://auth.example.com/oauth/token",
        })
        const originalFetch = globalThis.fetch
        let tokenCalls = 0
        let issued = 0
        globalThis.fetch = Object.assign(
          async (input: RequestInfo, init?: RequestInit) => {
            const url = String(input)
            if (url.includes("auth.example.com")) {
              tokenCalls++
              issued++
              // very short expiry to trigger proactive refresh check
              return new Response(JSON.stringify({ access_token: `t${issued}`, expires_in: 2 }), { status: 200 })
            }
            return new Response("ok", { status: 200 })
          },
          { preconnect: () => {} },
        ) as typeof fetch
        try {
          const prov = await Provider.getProvider("sap-ai-core")
          await prov.options.fetch!("https://api.example.com/infer")
          // wait 3s to surpass expiry - jitter ensures earlier expiry
          await Bun.sleep(3000)
          await prov.options.fetch!("https://api.example.com/infer")
          expect(tokenCalls).toBeGreaterThanOrEqual(2)
        } finally {
          globalThis.fetch = originalFetch
          restore()
        }
      },
    })
  })

  test("maps 429 to ProviderRateLimitError", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await withProviderConfig()
        const restore = setEnv({
          SAP_AI_CORE_URL: "https://api.example.com",
          SAP_AI_CORE_CLIENT_ID: "id",
          SAP_AI_CORE_CLIENT_SECRET: "secret",
          SAP_AI_CORE_OAUTH_URL: "https://auth.example.com/oauth/token",
        })
        const originalFetch = globalThis.fetch
        globalThis.fetch = Object.assign(
          async (input: RequestInfo, init?: RequestInit) => {
            const url = String(input)
            if (url.includes("auth.example.com")) {
              return new Response(JSON.stringify({ access_token: "t1", expires_in: 120 }), { status: 200 })
            }
            return new Response("", { status: 429, headers: { "Retry-After": "5" } })
          },
          { preconnect: () => {} },
        ) as typeof fetch
        try {
          const prov = await Provider.getProvider("sap-ai-core")
          await expect(prov.options.fetch!("https://api.example.com/infer")).rejects.toThrow("ProviderRateLimitError")
        } finally {
          globalThis.fetch = originalFetch
          restore()
        }
      },
    })
  })

  test("maps 401 to ProviderAuthError", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await withProviderConfig()
        const restore = setEnv({
          SAP_AI_CORE_URL: "https://api.example.com",
          SAP_AI_CORE_CLIENT_ID: "id",
          SAP_AI_CORE_CLIENT_SECRET: "secret",
          SAP_AI_CORE_OAUTH_URL: "https://auth.example.com/oauth/token",
        })
        const originalFetch = globalThis.fetch
        globalThis.fetch = Object.assign(
          async (input: RequestInfo, init?: RequestInit) => {
            const url = String(input)
            if (url.includes("auth.example.com")) {
              return new Response(JSON.stringify({ access_token: "t1", expires_in: 120 }), { status: 200 })
            }
            return new Response("", { status: 401 })
          },
          { preconnect: () => {} },
        ) as typeof fetch
        try {
          const prov = await Provider.getProvider("sap-ai-core")
          await expect(prov.options.fetch!("https://api.example.com/infer")).rejects.toThrow("ProviderAuthError")
        } finally {
          globalThis.fetch = originalFetch
          restore()
        }
      },
    })
  })

  test("alias mapping resolves real ID in config", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Config.update({ provider: { "sap-ai-core": { models: { alias: { id: "real-deploy" } } } } } as any)
        const restore = setEnv({
          SAP_AI_CORE_URL: "https://api.example.com",
          SAP_AI_CORE_CLIENT_ID: "id",
          SAP_AI_CORE_CLIENT_SECRET: "secret",
          SAP_AI_CORE_OAUTH_URL: "https://auth.example.com/oauth/token",
        })
        // mock fetch minimal for token + inference
        const originalFetch = globalThis.fetch
        globalThis.fetch = Object.assign(
          async (input: RequestInfo, init?: RequestInit) => {
            const url = String(input)
            if (url.includes("auth.example.com"))
              return new Response(JSON.stringify({ access_token: "t1", expires_in: 120 }), { status: 200 })
            return new Response("ok", { status: 200 })
          },
          { preconnect: () => {} },
        ) as typeof fetch
        try {
          const model = await Provider.getModel("sap-ai-core", "alias")
          expect(model.info.id).toBe("alias")
          // realIdByKey mapping occurs internally (can't access private map); ensure language model stored under alias
          expect(model.modelID).toBe("alias")
        } finally {
          globalThis.fetch = originalFetch
          restore()
        }
      },
    })
  })
})
