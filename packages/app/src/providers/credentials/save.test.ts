import { expect, test } from "bun:test"
import { OpenCode } from "@opencode/client/promise"
import { validateCustomProvider } from "./form"
import { saveCustomProvider } from "./save"

type Call = { method: string; path: string; body?: unknown }

function client(respond: (call: Call) => Response) {
  const calls: Call[] = []

  const api = OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init)

        const call: Call = {
          method: request.method,
          path: new URL(request.url).pathname,
          body: request.method === "POST" || request.method === "PATCH" ? await request.json() : undefined,
        }

        calls.push(call)

        return respond(call)
      },
      { preconnect() {} },
    ),
  })

  return { api, calls }
}

function provider(apiKey: string) {
  const result = validateCustomProvider({
    form: {
      providerID: "local",
      name: "My Local Server",
      baseURL: "http://127.0.0.1:8080/v1",
      apiKey,
      models: [{ row: "m0", id: "my-model", name: "My Model", err: {} }],
      headers: [{ row: "h0", key: "", value: "", err: {} }],
      err: {},
    },
    t: (key) => key,
    disabledProviders: [],
    existingProviderIDs: new Set(),
  }).result

  if (!result) throw new Error("The custom provider form did not validate")

  return result
}

const stored = {
  id: "cred_1",
  integrationID: "local",
  label: "My Local Server",
  active: true,
  value: { type: "key", key: "sk-local" },
}

test.each([
  { kind: "API key", apiKey: "sk-local", credentials: 1, env: undefined },
  { kind: "environment variable", apiKey: "{env: LOCAL_KEY}", credentials: 0, env: ["LOCAL_KEY"] },
  { kind: "no API key", apiKey: "", credentials: 0, env: undefined },
])("saves a custom provider using $kind", async ({ apiKey, credentials, env }) => {
  const { api, calls } = client((call) =>
    call.path === "/api/credential" ? Response.json({ data: stored }) : new Response(null, { status: 204 }),
  )

  await saveCustomProvider(api, provider(apiKey))

  expect(calls.filter((call) => call.path === "/api/credential")).toHaveLength(credentials)
  expect(calls.at(-1)?.method).toBe("PATCH")
  expect(calls.at(-1)?.path).toBe("/api/experimental/config")
  expect(calls.at(-1)?.body).toEqual({
    providers: {
      local: {
        package: "@opencode/ai/providers/openai-compatible",
        name: "My Local Server",
        env,
        settings: { baseURL: "http://127.0.0.1:8080/v1" },
        models: { "my-model": { name: "My Model" } },
      },
    },
  })
  // The secret belongs to the credential store, never to the config document.
  expect(JSON.stringify(calls.at(-1)?.body)).not.toContain("sk-local")

  if (!credentials) return

  expect(calls[0]).toEqual({
    method: "POST",
    path: "/api/credential",
    body: { integrationID: "local", label: "My Local Server", value: { type: "key", key: "sk-local" } },
  })
})

test("does not save the provider if its credential cannot be stored", async () => {
  const { api, calls } = client(() => new Response(null, { status: 500 }))

  await expect(saveCustomProvider(api, provider("sk-local"))).rejects.toThrow()
  expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual(["POST /api/credential"])
})

test("removes the stored credential when the config write is rejected", async () => {
  const { api, calls } = client((call) => {
    if (call.path === "/api/credential" && call.method === "POST") return Response.json({ data: stored })

    if (call.path === "/api/experimental/config") return new Response(null, { status: 500 })

    return new Response(null, { status: 204 })
  })

  await expect(saveCustomProvider(api, provider("sk-local"))).rejects.toThrow()

  expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
    "POST /api/credential",
    "PATCH /api/experimental/config",
    "DELETE /api/credential/cred_1",
  ])
})
