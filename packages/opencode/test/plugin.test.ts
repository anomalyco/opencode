import { describe, expect, test } from "bun:test"
import path from "path"

const fixturesPath = path.join(__dirname, "fixtures/plugins")

describe("Plugin loading logic", () => {
  test("imports valid TypeScript plugin file", async () => {
    const validTSPath = path.join(fixturesPath, "valid-ts.ts")
    const mod = await import(validTSPath)

    expect(mod.ValidTSPlugin).toBeTypeOf("function")
    expect(mod.AnotherValidPlugin).toBeTypeOf("function")

    // Plugin functions need context object
    const mockContext = { app: {}, client: {}, $: {} }

    const plugin1 = await mod.ValidTSPlugin(mockContext)
    expect(plugin1).toHaveProperty("event")
    expect(plugin1["chat.message"]).toBeTypeOf("function")
    expect(plugin1["tool.execute.before"]).toBeTypeOf("function")

    const plugin2 = await mod.AnotherValidPlugin(mockContext)
    expect(plugin2["permission.ask"]).toBeTypeOf("function")
  })
  test("imports valid JavaScript plugin file", async () => {
    const validJSPath = path.join(fixturesPath, "valid-js.js")
    const mod = await import(validJSPath)

    expect(mod.ValidJSPlugin).toBeTypeOf("function")
    expect(mod.SimpleJSPlugin).toBeTypeOf("function")

    // Plugin functions need context object
    const mockContext = { app: {}, client: {}, $: {} }

    const plugin1 = await mod.ValidJSPlugin(mockContext)
    expect(plugin1).toHaveProperty("event")
    expect(plugin1["chat.params"]).toBeTypeOf("function")
    expect(plugin1["tool.execute.after"]).toBeTypeOf("function")

    const plugin2 = await mod.SimpleJSPlugin(mockContext)
    expect(plugin2["permission.ask"]).toBeTypeOf("function")
  })

  test("handles import errors gracefully", async () => {
    const nonExistentPath = path.join(fixturesPath, "non-existent.js")

    let importError = null
    const mod = await import(nonExistentPath).catch((error) => {
      importError = error
      return null
    })

    expect(mod).toBe(null)
    expect(importError).toBeTruthy()
  })

  test("handles syntax error imports gracefully", async () => {
    const syntaxErrorPath = path.join(fixturesPath, "syntax-error.js")

    let importError = null
    const mod = await import(syntaxErrorPath).catch((error) => {
      importError = error
      return null
    })

    expect(mod).toBe(null)
    expect(importError).toBeTruthy()
  })

  test("plugin hook execution works correctly", async () => {
    const validTSPath = path.join(fixturesPath, "valid-ts.ts")
    const mod = await import(validTSPath)

    // Plugin functions need context object
    const mockContext = { app: {}, client: {}, $: {} }
    const plugin = await mod.ValidTSPlugin(mockContext)

    // Test tool.execute.before hook
    const input = { tool: "test", sessionID: "123", callID: "456" }
    const output = { args: {} as any }

    await plugin["tool.execute.before"](input, output)
    expect(output.args.testFlag).toBe("ts-plugin")

    // Test chat.message hook
    const chatInput = {}
    const chatOutput = { message: { content: "original" } as any }

    await plugin["chat.message"](chatInput, chatOutput)
    expect(chatOutput.message.testFlag).toBe("ts-plugin")
  })
  test("detects non-function exports", async () => {
    const invalidPluginPath = path.join(fixturesPath, "invalid-plugins.ts")
    const mod = await import(invalidPluginPath)

    // This would be used in the actual loading logic
    const checkExportType = (mod: any) => {
      const results = []
      for (const [name, fn] of Object.entries(mod)) {
        if (typeof fn !== "function") {
          results.push({ name, type: typeof fn, isFunction: false })
        } else {
          results.push({ name, type: typeof fn, isFunction: true })
        }
      }
      return results
    }

    const exports = checkExportType(mod)

    const notAFunctionExport = exports.find((e) => e.name === "NotAFunction")
    expect(notAFunctionExport?.isFunction).toBe(false)

    const functionExports = exports.filter((e) => e.isFunction)
    expect(functionExports.length).toBeGreaterThan(0)
  })

  test("plugin initialization error handling", async () => {
    const invalidPluginPath = path.join(fixturesPath, "invalid-plugins.ts")
    const mod = await import(invalidPluginPath)

    // Test FailingPlugin
    let initError: any = null
    const failingResult = await mod.FailingPlugin().catch((error: any) => {
      initError = error
      return null
    })

    expect(failingResult).toBe(null)
    expect(initError?.message).toBe("Plugin initialization failed")

    // Test InvalidStructurePlugin
    const invalidResult = await mod.InvalidStructurePlugin()
    expect(typeof invalidResult).toBe("string")
    expect(invalidResult).toBe("not an object with hooks")
  })

  test("plugin file path resolution", () => {
    // Test file:// prefix handling
    const filePaths = [
      "file:///absolute/path/plugin.js",
      "/absolute/path/plugin.js",
      "npm-package",
      "npm-package@1.0.0",
    ]

    const processPluginPath = (plugin: string) => {
      if (!plugin.startsWith("file://")) {
        const [pkg, version] = plugin.split("@")
        return { type: "npm", pkg, version: version ?? "latest" }
      }
      return { type: "file", path: plugin }
    }

    const results = filePaths.map(processPluginPath)

    expect(results[0]).toEqual({ type: "file", path: "file:///absolute/path/plugin.js" })
    expect(results[1]).toEqual({ type: "npm", pkg: "/absolute/path/plugin.js", version: "latest" })
    expect(results[2]).toEqual({ type: "npm", pkg: "npm-package", version: "latest" })
    expect(results[3]).toEqual({ type: "npm", pkg: "npm-package", version: "1.0.0" })
  })
})

describe("Plugin configuration glob patterns", () => {
  test("glob pattern matches both .ts and .js files", () => {
    const pattern = "plugin/*.{ts,js}"
    const testFiles = ["plugin/test.ts", "plugin/test.js", "plugin/test.tsx", "plugin/test.json"]

    // Simple pattern matching test
    const matchesPattern = (file: string, pattern: string) => {
      if (pattern === "plugin/*.{ts,js}") {
        return file.match(/^plugin\/.*\.(ts|js)$/) !== null
      }
      return false
    }

    const matches = testFiles.filter((f) => matchesPattern(f, pattern))

    expect(matches).toEqual(["plugin/test.ts", "plugin/test.js"])
    expect(matches).not.toContain("plugin/test.tsx")
    expect(matches).not.toContain("plugin/test.json")
  })
})
