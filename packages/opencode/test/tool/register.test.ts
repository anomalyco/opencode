import { describe, expect, test } from "bun:test"
import path from "path"
import os from "os"
import { Instance } from "../../src/project/instance"

// Helper to create a Request targeting the in-memory Hono app
function makeRequest(method: string, url: string, body?: any) {
  const headers: Record<string, string> = { "content-type": "application/json" }
  const init: RequestInit = { method, headers }
  if (body !== undefined) init.body = JSON.stringify(body)
  return new Request(url, init)
}

describe("HTTP tool registration API", () => {
  test("POST /tool/register then list via /tool/ids and /tool", async () => {
    const projectRoot = path.join(__dirname, "../..")
    await Instance.provide(projectRoot, async () => {
      const { Server } = await import("../../src/server/server")

      const toolSpec = {
        id: "http-echo",
        description: "Simple echo tool (test-only)",
        parameters: {
          type: "object" as const,
          properties: {
            foo: { type: "string" as const, optional: true },
            bar: { type: "number" as const },
          },
        },
        callbackUrl: "http://localhost:9999/echo",
      }

      // Register
      const registerRes = await Server.App.fetch(
        makeRequest("POST", "http://localhost:4096/experimental/tool/register", toolSpec),
      )
      expect(registerRes.status).toBe(200)
      const ok = await registerRes.json()
      expect(ok).toBe(true)

      // IDs should include the new tool
      const idsRes = await Server.App.fetch(makeRequest("GET", "http://localhost:4096/experimental/tool/ids"))
      expect(idsRes.status).toBe(200)
      const ids = (await idsRes.json()) as string[]
      expect(ids).toContain("http-echo")

      // List tools for a provider/model and check JSON Schema shape
      const listRes = await Server.App.fetch(
        makeRequest("GET", "http://localhost:4096/experimental/tool?provider=openai&model=gpt-4o"),
      )
      expect(listRes.status).toBe(200)
      const list = (await listRes.json()) as Array<{ id: string; description: string; parameters: any }>
      const found = list.find((t) => t.id === "http-echo")
      expect(found).toBeTruthy()
      expect(found!.description).toBe("Simple echo tool (test-only)")

      // Basic JSON Schema checks
      expect(found!.parameters?.type).toBe("object")
      expect(found!.parameters?.properties?.bar?.type).toBe("number")

      const foo = found!.parameters?.properties?.foo
      // optional -> nullable for OpenAI/Azure providers; accept either type array including null or nullable: true
      const fooIsNullable = Array.isArray(foo?.type) ? foo.type.includes("null") : foo?.nullable === true
      expect(fooIsNullable).toBe(true)
    })
  })
})

describe("Plugin tool.register hook", () => {
  test("Plugin registers tool during Plugin.init()", async () => {
    // Create a temporary project directory with opencode.json that points to our plugin
    const tmpDir = path.join(os.tmpdir(), `opencode-test-project-${Date.now()}`)
    await Bun.$`mkdir -p ${tmpDir}`

    const tmpPluginPath = path.join(tmpDir, `test-plugin-${Date.now()}.ts`)
    const pluginCode = `
      export async function TestPlugin() {
        return {
          async ["tool.register"](_input, { registerHTTP }) {
            registerHTTP({
              id: "from-plugin",
              description: "Registered from test plugin",
              parameters: { type: "object", properties: { name: { type: "string", optional: true } } },
              callbackUrl: "http://localhost:9999/echo"
            })
          }
        }
      }
    `
    await Bun.write(tmpPluginPath, pluginCode)

    const configPath = path.join(tmpDir, "opencode.json")
    await Bun.write(configPath, JSON.stringify({ plugin: ["file://" + tmpPluginPath] }, null, 2))

    await Instance.provide(tmpDir, async () => {
      const { Plugin } = await import("../../src/plugin")
      const { ToolRegistry } = await import("../../src/tool/registry")
      const { Server } = await import("../../src/server/server")

      // Initialize plugins (will invoke our tool.register hook)
      await Plugin.init()

      // Confirm the tool is registered
      const allIDs = ToolRegistry.ids()
      expect(allIDs).toContain("from-plugin")

      // Also verify via the HTTP surface
      const idsRes = await Server.App.fetch(makeRequest("GET", "http://localhost:4096/experimental/tool/ids"))
      expect(idsRes.status).toBe(200)
      const ids = (await idsRes.json()) as string[]
      expect(ids).toContain("from-plugin")
    })
  })
})

test("Multiple plugins can each register tools", async () => {
  const tmpDir = path.join(os.tmpdir(), `opencode-test-project-multi-${Date.now()}`)
  await Bun.$`mkdir -p ${tmpDir}`

  // Create two plugin files
  const pluginAPath = path.join(tmpDir, `plugin-a-${Date.now()}.ts`)
  const pluginBPath = path.join(tmpDir, `plugin-b-${Date.now()}.ts`)
  const pluginA = `
    export async function PluginA() {
      return {
        async ["tool.register"](_input, { registerHTTP }) {
          registerHTTP({
            id: "alpha-tool",
            description: "Alpha tool",
            parameters: { type: "object", properties: { a: { type: "string", optional: true } } },
            callbackUrl: "http://localhost:9999/echo"
          })
        }
      }
    }
  `
  const pluginB = `
    export async function PluginB() {
      return {
        async ["tool.register"](_input, { registerHTTP }) {
          registerHTTP({
            id: "beta-tool",
            description: "Beta tool",
            parameters: { type: "object", properties: { b: { type: "number", optional: true } } },
            callbackUrl: "http://localhost:9999/echo"
          })
        }
      }
    }
  `
  await Bun.write(pluginAPath, pluginA)
  await Bun.write(pluginBPath, pluginB)

  // Config with both plugins
  await Bun.write(
    path.join(tmpDir, "opencode.json"),
    JSON.stringify({ plugin: ["file://" + pluginAPath, "file://" + pluginBPath] }, null, 2),
  )

  await Instance.provide(tmpDir, async () => {
    const { Plugin } = await import("../../src/plugin")
    const { ToolRegistry } = await import("../../src/tool/registry")
    const { Server } = await import("../../src/server/server")

    await Plugin.init()

    const ids = ToolRegistry.ids()
    expect(ids).toContain("alpha-tool")
    expect(ids).toContain("beta-tool")

    const res = await Server.App.fetch(new Request("http://localhost:4096/experimental/tool/ids"))
    expect(res.status).toBe(200)
    const httpIds = (await res.json()) as string[]
    expect(httpIds).toContain("alpha-tool")
    expect(httpIds).toContain("beta-tool")
  })
})

test("Plugin registers native/local tool with function execution", async () => {
  const tmpDir = path.join(os.tmpdir(), `opencode-test-project-native-${Date.now()}`)
  await Bun.$`mkdir -p ${tmpDir}`

  const pluginPath = path.join(tmpDir, `plugin-native-${Date.now()}.ts`)
  const pluginCode = `
    export async function NativeToolPlugin({ $, Tool, z }) {
      // Use z (zod) provided by the plugin system
      
      // Define a native tool using Tool.define from plugin input
      const MyNativeTool = Tool.define("my-native-tool", {
        description: "A native tool that runs local code",
        parameters: z.object({
          message: z.string().describe("Message to process"),
          count: z.number().optional().describe("Repeat count").default(1)
        }),
        async execute(args, ctx) {
          // This runs locally in the plugin process, not via HTTP!
          const result = args.message.repeat(args.count)
          const output = \`Processed: \${result}\`
          
          // Can also run shell commands directly  
          const hostname = await $\`hostname\`.text()
          
          return {
            title: "Native Tool Result",
            output: output + " on " + hostname.trim(),
            metadata: { processedAt: new Date().toISOString() }
          }
        }
      })
      
      return {
        async ["tool.register"](_input, { register, registerHTTP }) {
          // Register our native tool
          register(MyNativeTool)
          
          // Can also register HTTP tools in the same plugin
          registerHTTP({
            id: "http-tool-from-same-plugin",
            description: "HTTP tool alongside native tool",
            parameters: { type: "object", properties: {} },
            callbackUrl: "http://localhost:9999/echo"
          })
        }
      }
    }
  `
  await Bun.write(pluginPath, pluginCode)

  await Bun.write(path.join(tmpDir, "opencode.json"), JSON.stringify({ plugin: ["file://" + pluginPath] }, null, 2))

  await Instance.provide(tmpDir, async () => {
    const { Plugin } = await import("../../src/plugin")
    const { ToolRegistry } = await import("../../src/tool/registry")
    const { Server } = await import("../../src/server/server")

    await Plugin.init()

    // Both tools should be registered
    const ids = ToolRegistry.ids()
    expect(ids).toContain("my-native-tool")
    expect(ids).toContain("http-tool-from-same-plugin")

    // Verify via HTTP endpoint
    const res = await Server.App.fetch(new Request("http://localhost:4096/experimental/tool/ids"))
    expect(res.status).toBe(200)
    const httpIds = (await res.json()) as string[]
    expect(httpIds).toContain("my-native-tool")
    expect(httpIds).toContain("http-tool-from-same-plugin")

    // Get tool details to verify native tool has proper structure
    const toolsRes = await Server.App.fetch(
      new Request("http://localhost:4096/experimental/tool?provider=anthropic&model=claude"),
    )
    expect(toolsRes.status).toBe(200)
    const tools = (await toolsRes.json()) as any[]
    const nativeTool = tools.find((t) => t.id === "my-native-tool")
    expect(nativeTool).toBeTruthy()
    expect(nativeTool.description).toBe("A native tool that runs local code")
    expect(nativeTool.parameters.properties.message).toBeTruthy()
    expect(nativeTool.parameters.properties.count).toBeTruthy()
  })
})

// Malformed plugin (no tool.register) should not throw and should not register anything
test("Plugin without tool.register is handled gracefully", async () => {
  const tmpDir = path.join(os.tmpdir(), `opencode-test-project-noreg-${Date.now()}`)
  await Bun.$`mkdir -p ${tmpDir}`

  const pluginPath = path.join(tmpDir, `plugin-noreg-${Date.now()}.ts`)
  const pluginSrc = `
    export async function NoRegisterPlugin() {
      return {
        // no tool.register hook provided
        async config(_cfg) { /* noop */ }
      }
    }
  `
  await Bun.write(pluginPath, pluginSrc)

  await Bun.write(path.join(tmpDir, "opencode.json"), JSON.stringify({ plugin: ["file://" + pluginPath] }, null, 2))

  await Instance.provide(tmpDir, async () => {
    const { Plugin } = await import("../../src/plugin")
    const { ToolRegistry } = await import("../../src/tool/registry")
    const { Server } = await import("../../src/server/server")

    await Plugin.init()

    // Ensure our specific id isn't present
    const ids = ToolRegistry.ids()
    expect(ids).not.toContain("malformed-tool")

    const res = await Server.App.fetch(new Request("http://localhost:4096/experimental/tool/ids"))
    expect(res.status).toBe(200)
    const httpIds = (await res.json()) as string[]
    expect(httpIds).not.toContain("malformed-tool")
  })
})
