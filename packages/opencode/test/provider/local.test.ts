import { test, expect, mock, afterEach } from "bun:test"
import path from "path"

import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { ProviderID } from "../../src/provider/schema"

const originalFetch = globalThis.fetch

function mockFetch(handler: (url: string) => Response | undefined) {
  ;(globalThis as any).fetch = mock((url: string | URL | Request) => {
    const u = typeof url === "string" ? url : url instanceof URL ? url.href : url.url
    const result = handler(u)
    if (result) return Promise.resolve(result)
    return originalFetch(url as RequestInfo, undefined)
  })
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

test("local provider discovers models from /models endpoint", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            local: {
              options: {
                baseURL: "http://localhost:11434/v1",
              },
            },
          },
        }),
      )
    },
  })

  mockFetch((url) => {
    if (url === "http://localhost:11434/v1/models") {
      return new Response(
        JSON.stringify({
          data: [{ id: "llama-3-8b" }, { id: "mistral-7b" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )
    }
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const providers = await Provider.list()
      const local = providers["local"]
      expect(local).toBeDefined()
      expect(local.models["llama-3-8b"]).toBeDefined()
      expect(local.models["mistral-7b"]).toBeDefined()
      expect(local.models["llama-3-8b"].providerID).toBe(ProviderID.make("local"))
    },
  })
})

test("local provider not loaded when endpoint unreachable", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            local: {
              options: {
                baseURL: "http://localhost:9999/v1",
              },
            },
          },
        }),
      )
    },
  })

  ;(globalThis as any).fetch = mock((url: string | URL | Request) => {
    const u = typeof url === "string" ? url : url instanceof URL ? url.href : url.url
    if (u === "http://localhost:9999/v1/models") {
      return Promise.reject(new Error("ECONNREFUSED"))
    }
    return originalFetch(url as RequestInfo, undefined)
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["local"]).toBeUndefined()
    },
  })
})

test("local provider not loaded without baseURL", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          provider: {
            local: {
              options: {},
            },
          },
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const providers = await Provider.list()
      expect(providers["local"]).toBeUndefined()
    },
  })
})
