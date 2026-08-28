import { afterEach, describe, expect, test } from "bun:test"
import { chmod } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { tmpdir } from "../fixture/fixture"
import type { Hooks } from "@opencode-ai/plugin"
import type { Auth, Provider } from "@opencode-ai/sdk/v2"
import { OAUTH_DUMMY_KEY } from "../../src/auth"
import { AzureAuthPlugin, createAzureAuthHooks } from "../../src/plugin/azure"
import { Process } from "../../src/util/process"
import { which } from "@opencode-ai/core/util/which"

const resourceName = process.env.AZURE_RESOURCE_NAME
const resourceGroup = process.env.AZURE_RESOURCE_GROUP
const azureConfig = process.env.AZURE_CONFIG_DIR
const originalPath = process.env.PATH

afterEach(() => {
  if (resourceName === undefined) delete process.env.AZURE_RESOURCE_NAME
  else process.env.AZURE_RESOURCE_NAME = resourceName
  if (resourceGroup === undefined) delete process.env.AZURE_RESOURCE_GROUP
  else process.env.AZURE_RESOURCE_GROUP = resourceGroup
  if (azureConfig === undefined) delete process.env.AZURE_CONFIG_DIR
  else process.env.AZURE_CONFIG_DIR = azureConfig
  if (originalPath === undefined) delete process.env.PATH
  else process.env.PATH = originalPath
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
  return async (args: string[]) => {
    const scope = args[args.indexOf("--scope") + 1]
    scopes.push(scope)
    return {
      accessToken: `${scope}-token`,
      expires_on: Math.floor((Date.now() + 60 * 60 * 1000) / 1000),
    }
  }
}

function discoveryShell(accounts: unknown, deployments: unknown, commands: string[]) {
  return async (args: string[]) => {
    const command = ["az", ...args].join(" ")
    commands.push(command)
    return command.includes("deployment list") ? deployments : accounts
  }
}

async function azureCli(dir: string) {
  const bin = path.join(dir, "azure cli")
  const calls = path.join(dir, "calls.jsonl")
  const script = path.join(bin, "cli.cjs")
  await Bun.write(calls, "")
  await Bun.write(
    script,
    `
    const fs = require("node:fs")
    const args = process.argv.slice(2)
    fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(args) + "\\n")
    console.log(JSON.stringify(args.includes("get-access-token")
      ? { accessToken: "test-token", expires_on: Math.floor(Date.now() / 1000) + 3600 }
      : args.includes("deployment") ? [] : [{ name: "test-resource", resourceGroup: "test group & value" }]))
  `,
  )
  const executable = path.join(bin, process.platform === "win32" ? "az.cmd" : "az")
  await Bun.write(
    executable,
    process.platform === "win32"
      ? `@"${process.execPath}" "${script}" %*\r\n`
      : `#!/bin/sh\nexec '${process.execPath}' '${script}' "$@"\n`,
  )
  await chmod(executable, 0o755)
  return {
    bin,
    calls: async () =>
      (await Bun.file(calls).text())
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
  }
}

describe("plugin.azure", () => {
  test("initializes and runs Azure CLI under Node without Bun or a plugin shell", async () => {
    await using tmp = await tmpdir()
    const node = which("node")
    if (!node) throw new Error("Node is required for the Azure runtime compatibility test")
    const bundle = await Bun.build({
      entrypoints: [path.join(import.meta.dir, "../../src/plugin/azure.ts")],
      target: "node",
      format: "esm",
    })
    expect(bundle.success).toBe(true)
    const entry = path.join(tmp.path, "azure.mjs")
    await Bun.write(entry, bundle.outputs[0])
    const cli = await azureCli(tmp.path)
    await Bun.write(path.join(tmp.path, "azureProfile.json"), '\uFEFF{"subscriptions":[{}]}')
    for (const installed of [false, true]) {
      const result = await Process.run(
        [
          node,
          "--input-type=module",
          "-e",
          `
        import assert from "node:assert/strict"
        import { AzureAuthPlugin } from ${JSON.stringify(pathToFileURL(entry).href)}
        assert.equal(typeof Bun, "undefined")
        delete process.env.AZURE_RESOURCE_NAME
        delete process.env.AZURE_RESOURCE_GROUP
        const hooks = await AzureAuthPlugin({ $: undefined })
        assert.equal(hooks.auth.provider, "azure")
        assert.deepEqual(hooks.auth.methods.map((method) => method.type), ${JSON.stringify(installed ? ["api", "oauth"] : ["api"])})
        if (${installed}) {
          const method = hooks.auth.methods.find((method) => method.type === "oauth")
          assert.equal(method.prompts[0].type, "select")
          const authorization = await method.authorize({ resourceSelection: "test-resource" })
          const auth = await authorization.callback()
          assert.equal(auth.type, "success")
          assert.equal(auth.accountId, "test-resource")
          assert.deepEqual(await hooks.provider.models({ models: {} }, { auth: { ...auth, type: "oauth" } }), {})
        }
      `,
        ],
        {
          env: { PATH: installed ? cli.bin : tmp.path, XDG_DATA_HOME: tmp.path, AZURE_CONFIG_DIR: tmp.path },
          nothrow: true,
        },
      )
      expect(result.stderr.toString()).toBe("")
      expect(result.code).toBe(0)
    }
    expect(await cli.calls()).toEqual([
      ["cognitiveservices", "account", "list", "--output", "json", "--only-show-errors"],
      ["account", "get-access-token", "--scope", "https://cognitiveservices.azure.com/.default", "--output", "json"],
      ["cognitiveservices", "account", "list", "--output", "json", "--only-show-errors"],
      [
        "cognitiveservices",
        "account",
        "deployment",
        "list",
        "--name",
        "test-resource",
        "--resource-group",
        "test group & value",
        "--output",
        "json",
        "--only-show-errors",
      ],
    ])
  })

  for (const profile of [
    { name: "missing", content: undefined, signedIn: false },
    { name: "logged out", content: '{"subscriptions":[]}', signedIn: false },
    { name: "signed in with BOM", content: '\uFEFF{"subscriptions":[{}]}', signedIn: true },
  ]) {
    test(`only lists resources for a cached Azure login (${profile.name})`, async () => {
      await using tmp = await tmpdir()
      const cli = await azureCli(tmp.path)
      process.env.PATH = cli.bin
      process.env.AZURE_CONFIG_DIR = path.join(tmp.path, "azure-cli")
      if (profile.content)
        await Bun.write(path.join(process.env.AZURE_CONFIG_DIR, "azureProfile.json"), profile.content)
      delete process.env.AZURE_RESOURCE_NAME
      delete process.env.AZURE_RESOURCE_GROUP
      const hooks = await AzureAuthPlugin()

      expect(await cli.calls()).toHaveLength(profile.signedIn ? 1 : 0)
      expect(hooks.auth?.methods.some((method) => method.type === "oauth")).toBe(true)
      if (profile.signedIn) expect(oauthMethod(hooks).prompts?.[0].type).toBe("select")
    })
  }

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

  test("hides Azure CLI authentication when the Azure CLI is not installed", () => {
    const hooks = createAzureAuthHooks(azureShell([]), fetch, [], false)

    expect(hooks.auth?.methods.map((method) => method.type)).toEqual(["api"])
  })

  test("lists Azure CLI resources and allows entering another resource", () => {
    delete process.env.AZURE_RESOURCE_NAME
    const hooks = createAzureAuthHooks(azureShell([]), fetch, [
      { name: "first-resource", resourceGroup: "first-group" },
      { name: "second-resource", resourceGroup: "second-group" },
    ])

    expect(oauthMethod(hooks).prompts).toEqual([
      {
        type: "select",
        key: "resourceSelection",
        message: "Select Azure resource",
        options: [
          { label: "first-resource", value: "first-resource", hint: "first-group" },
          { label: "second-resource", value: "second-resource", hint: "second-group" },
          { label: "Enter another resource name", value: "__manual__" },
        ],
      },
      {
        type: "text",
        key: "resourceName",
        message: "Enter Azure Resource Name",
        placeholder: "e.g. my-models",
        when: { key: "resourceSelection", op: "eq", value: "__manual__" },
      },
    ])
  })

  test("uses the selected Azure CLI resource", async () => {
    const hooks = createAzureAuthHooks(azureShell([]), fetch, [
      { name: "selected-resource", resourceGroup: "selected-group" },
    ])
    const authorization = await oauthMethod(hooks).authorize({ resourceSelection: "selected-resource" })
    if (authorization.method !== "auto") throw new Error("Unexpected Azure authorization method")

    expect(await authorization.callback()).toMatchObject({ type: "success", accountId: "selected-resource" })
  })

  test("uses a manually entered Azure resource that was not listed", async () => {
    const hooks = createAzureAuthHooks(azureShell([]), fetch, [{ name: "listed-resource", resourceGroup: "group" }])
    const authorization = await oauthMethod(hooks).authorize({
      resourceSelection: "__manual__",
      resourceName: "unlisted-resource",
    })
    if (authorization.method !== "auto") throw new Error("Unexpected Azure authorization method")

    expect(await authorization.callback()).toMatchObject({ type: "success", accountId: "unlisted-resource" })
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

  test("supports Azure CLI versions that only provide expiresOn", async () => {
    const hooks = createAzureAuthHooks(async () => ({
      accessToken: "legacy-token",
      expiresOn: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    }))
    const authorization = await oauthMethod(hooks).authorize({ resourceName: "test-resource" })
    if (authorization.method !== "auto") throw new Error("Unexpected Azure authorization method")

    expect(await authorization.callback()).toMatchObject({ type: "success", accountId: "test-resource" })
  })

  test("rejects Azure CLI tokens without a usable expiration", async () => {
    const hooks = createAzureAuthHooks(async () => ({ accessToken: "invalid-token" }))
    const authorization = await oauthMethod(hooks).authorize({ resourceName: "test-resource" })
    if (authorization.method !== "auto") throw new Error("Unexpected Azure authorization method")

    await expect(authorization.callback()).rejects.toThrow("Azure CLI returned an invalid token expiration")
  })

  test("discovers deployed models through Azure CLI", async () => {
    delete process.env.AZURE_RESOURCE_GROUP
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

  test("discovers models directly when the resource group is configured", async () => {
    process.env.AZURE_RESOURCE_GROUP = "restricted-group"
    const commands: string[] = []
    const hooks = createAzureAuthHooks(
      discoveryShell(
        [],
        [{ name: "gpt-production", properties: { model: { name: "gpt-5-mini" }, provisioningState: "Succeeded" } }],
        commands,
      ),
    )
    const list = hooks.provider?.models
    if (!list) throw new Error("Azure provider model hook is missing")

    const result = await list({ ...provider, models: models("gpt-5-mini") }, { auth: oauth })

    expect(result["gpt-5-mini"].api.id).toBe("gpt-production")
    expect(commands).toEqual([
      "az cognitiveservices account deployment list --name test-resource --resource-group restricted-group --output json --only-show-errors",
    ])
  })

  test("preserves multiple deployments of the same model", async () => {
    delete process.env.AZURE_RESOURCE_GROUP
    const hooks = createAzureAuthHooks(
      discoveryShell(
        [{ name: "test-resource", resourceGroup: "test-group" }],
        [
          { name: "gpt-production", properties: { model: { name: "gpt-5-mini" }, provisioningState: "Succeeded" } },
          { name: "gpt-staging", properties: { model: { name: "gpt-5-mini" }, provisioningState: "Succeeded" } },
        ],
        [],
      ),
    )
    const list = hooks.provider?.models
    if (!list) throw new Error("Azure provider model hook is missing")

    const result = await list({ ...provider, models: models("gpt-5-mini") }, { auth: oauth })

    expect(Object.keys(result)).toEqual(["gpt-5-mini", "gpt-staging"])
    expect(result["gpt-5-mini"].api.id).toBe("gpt-production")
    expect(result["gpt-staging"].api.id).toBe("gpt-staging")
    expect(result["gpt-staging"].name).toBe("gpt-5-mini (gpt-staging)")
  })

  test("keeps configured models available when Azure discovery fails", async () => {
    const hooks = createAzureAuthHooks(async () => {
      throw new Error("Azure CLI failed")
    })
    const list = hooks.provider?.models
    if (!list) throw new Error("Azure provider model hook is missing")

    const catalog = models("gpt-5-mini")
    expect(await list({ ...provider, models: catalog }, { auth: oauth })).toBe(catalog)
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
