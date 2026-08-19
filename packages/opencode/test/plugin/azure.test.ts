import { afterEach, describe, expect, test } from "bun:test"
import type { Hooks } from "@opencode-ai/plugin"
import type { Auth, Provider } from "@opencode-ai/sdk/v2"
import { OAUTH_DUMMY_KEY } from "../../src/auth"
import { createAzureAuthHooks } from "../../src/plugin/azure"

const resourceName = process.env.AZURE_RESOURCE_NAME

afterEach(() => {
  if (resourceName === undefined) delete process.env.AZURE_RESOURCE_NAME
  else process.env.AZURE_RESOURCE_NAME = resourceName
})

const oauth: Auth = {
  type: "oauth",
  access: OAUTH_DUMMY_KEY,
  refresh: OAUTH_DUMMY_KEY,
  expires: Date.now() + 60 * 60 * 1000,
  accountId: "test-resource",
}

const provider: Provider = {
  id: "azure",
  name: "Azure",
  source: "custom",
  env: [],
  options: {},
  models: {},
}

function oauthMethod(hooks: Hooks) {
  const method = hooks.auth?.methods.find((method) => method.type === "oauth")
  if (!method || method.type !== "oauth") throw new Error("Azure OAuth method is missing")
  return method
}

function loader(hooks: Hooks) {
  if (!hooks.auth?.loader) throw new Error("Azure auth loader is missing")
  return hooks.auth.loader
}

function customFetch(options: Record<string, unknown>) {
  const result = options["fetch"]
  if (typeof result !== "function") throw new Error("Azure custom fetch is missing")
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const response: unknown = await Reflect.apply(result, undefined, [input, init])
    if (!(response instanceof Response)) throw new Error("Azure custom fetch returned an invalid response")
    return response
  }
}

function models(...ids: string[]): Provider["models"] {
  return Object.fromEntries(
    ids.map((id) => [
      id,
      {
        id,
        providerID: "azure",
        name: id,
        family: "",
        api: { id, url: "", npm: "@ai-sdk/azure" },
        status: "active",
        headers: {},
        options: {},
        cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
        limit: { context: 0, output: 0 },
        capabilities: {
          temperature: true,
          reasoning: false,
          attachment: false,
          toolcall: true,
          input: { text: true, audio: false, image: false, video: false, pdf: false },
          output: { text: true, audio: false, image: false, video: false, pdf: false },
          interleaved: false,
        },
        release_date: "",
        variants: {},
      },
    ]),
  )
}

function azureShell(scopes: string[]) {
  return (_strings: TemplateStringsArray, ...values: string[]) => {
    const output = {
      quiet: () => output,
      json: async () => {
        const scope = values[0]
        scopes.push(scope)
        return {
          accessToken: `${scope}-token`,
          expires_on: Math.floor((Date.now() + 60 * 60 * 1000) / 1000),
        }
      },
    }
    return output
  }
}

function discoveryShell(accounts: unknown, deployments: unknown, commands: string[]) {
  return (strings: TemplateStringsArray, ...values: string[]) => {
    const command = String.raw(strings, ...values)
    commands.push(command)
    const output = {
      quiet: () => output,
      json: async () => (command.includes("deployment list") ? deployments : accounts),
    }
    return output
  }
}

describe("plugin.azure", () => {
  test("keeps the existing API-key method and adds Entra ID", () => {
    delete process.env.AZURE_RESOURCE_NAME
    const hooks = createAzureAuthHooks(azureShell([]))

    expect(hooks.auth?.provider).toBe("azure")
    expect(hooks.provider?.id).toBe("azure")
    expect(hooks.auth?.methods.map((method) => [method.type, method.label])).toEqual([
      ["api", "API key"],
      ["oauth", "Microsoft Entra ID (Azure CLI)"],
    ])
    expect(hooks.auth?.methods[0]).toEqual({
      type: "api",
      label: "API key",
      prompts: [
        {
          type: "text",
          key: "resourceName",
          message: "Enter Azure Resource Name",
          placeholder: "e.g. my-models",
        },
      ],
    })
    expect(hooks.auth?.methods[1].prompts).toEqual(hooks.auth?.methods[0].prompts)
  })

  test("checks Azure CLI and stores the resource name", async () => {
    const scopes: string[] = []
    const hooks = createAzureAuthHooks(azureShell(scopes))
    const authorization = await oauthMethod(hooks).authorize({ resourceName: "test-resource" })
    if (authorization.method !== "auto") throw new Error("Unexpected Azure authorization method")

    expect(await authorization.callback()).toMatchObject({
      type: "success",
      access: OAUTH_DUMMY_KEY,
      refresh: OAUTH_DUMMY_KEY,
      accountId: "test-resource",
    })
    expect(scopes).toEqual(["https://cognitiveservices.azure.com/.default"])
  })

  test("discovers deployed models through Azure CLI", async () => {
    const commands: string[] = []
    const hooks = createAzureAuthHooks(
      discoveryShell(
        [{ name: "test-resource", resourceGroup: "test-group" }],
        [
          {
            name: "gpt-production",
            properties: { model: { name: "gpt-5-mini" }, provisioningState: "Succeeded" },
          },
          {
            name: "DeepSeek-V4-Flash",
            properties: { model: { name: "DeepSeek-V4-Flash" }, provisioningState: "Succeeded" },
          },
          {
            name: "phi-production",
            properties: { model: { name: "Phi-4-mini-instruct" }, provisioningState: "Succeeded" },
          },
          {
            name: "gpt-5-nano",
            properties: { model: { name: "gpt-5-nano" }, provisioningState: "Creating" },
          },
        ],
        commands,
      ),
    )
    const list = hooks.provider?.models
    if (!list) throw new Error("Azure provider model hook is missing")

    const result = await list(
      {
        ...provider,
        models: models("gpt-5-mini", "deepseek-v4-flash", "phi-4-mini", "phi-4-mini-instruct", "gpt-5-nano"),
      },
      { auth: oauth },
    )

    expect(Object.keys(result)).toEqual(["gpt-5-mini", "deepseek-v4-flash", "phi-4-mini-instruct"])
    expect(result["gpt-5-mini"].api.id).toBe("gpt-production")
    expect(result["deepseek-v4-flash"].api.id).toBe("DeepSeek-V4-Flash")
    expect(result["phi-4-mini-instruct"].api.id).toBe("phi-production")
    expect(commands).toEqual([
      "az cognitiveservices account list --output json --only-show-errors",
      "az cognitiveservices account deployment list --name test-resource --resource-group test-group --output json --only-show-errors",
    ])
  })

  test("keeps startup running when Azure discovery fails", async () => {
    const hooks = createAzureAuthHooks(() => {
      const output = {
        quiet: () => output,
        json: async () => {
          throw new Error("Azure CLI failed")
        },
      }
      return output
    })
    const list = hooks.provider?.models
    if (!list) throw new Error("Azure provider model hook is missing")

    expect(await list({ ...provider, models: models("gpt-5-mini") }, { auth: oauth })).toEqual({})
  })

  test("does not change API-key loading", async () => {
    const scopes: string[] = []
    const hooks = createAzureAuthHooks(azureShell(scopes))
    const catalog = models("gpt-5-mini")
    const list = hooks.provider?.models
    if (!list) throw new Error("Azure provider model hook is missing")

    expect(await loader(hooks)(async () => ({ type: "api", key: "test-key" }), provider)).toEqual({})
    expect(await list({ ...provider, models: catalog }, { auth: { type: "api", key: "test-key" } })).toBe(catalog)
    expect(scopes).toEqual([])
  })

  test("uses Azure CLI bearer tokens for Azure inference endpoints", async () => {
    const scopes: string[] = []
    const requests: Headers[] = []
    const hooks = createAzureAuthHooks(azureShell(scopes), async (_input, init) => {
      requests.push(new Headers(init?.headers))
      return new Response(null, { status: 200 })
    })
    const options = await loader(hooks)(async () => oauth, provider)
    const request = customFetch(options)

    await request("https://test-resource.openai.azure.com/openai/v1/responses", {
      headers: { "api-key": OAUTH_DUMMY_KEY, "x-keep": "yes" },
    })
    await request("https://test-resource.services.ai.azure.com/models/chat/completions", {
      headers: { Authorization: `Bearer ${OAUTH_DUMMY_KEY}` },
    })
    await request("https://test-resource.services.ai.azure.com/anthropic/v1/messages", {
      headers: { "x-api-key": OAUTH_DUMMY_KEY },
    })

    expect(scopes).toEqual(["https://cognitiveservices.azure.com/.default", "https://ai.azure.com/.default"])
    expect(requests.map((headers) => headers.get("authorization"))).toEqual([
      "Bearer https://cognitiveservices.azure.com/.default-token",
      "Bearer https://cognitiveservices.azure.com/.default-token",
      "Bearer https://ai.azure.com/.default-token",
    ])
    expect(requests[0].get("api-key")).toBeNull()
    expect(requests[0].get("x-keep")).toBe("yes")
    expect(requests[2].get("x-api-key")).toBeNull()
    expect(requests.every((headers) => headers.get("user-agent")?.startsWith("opencode/"))).toBe(true)
  })
})
