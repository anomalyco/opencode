import { describe, test, expect } from "bun:test"
import { Agent } from "../src/agent/agent"
import { Config } from "../src/config/config"
import { Instance } from "../src/project/instance"
import { PermissionNext } from "../src/permission/next"
import { tmpdir } from "./fixture/fixture"

describe("enhance agent definition", () => {
  test("exists in the built-in agents map", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const agent = await Agent.get("enhance")
        expect(agent).toBeDefined()
      },
    })
  })

  test("has correct built-in properties", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const agent = await Agent.get("enhance")
        expect(agent!.name).toBe("enhance")
        expect(agent!.mode).toBe("primary")
        expect(agent!.native).toBe(true)
        expect(agent!.hidden).toBe(true)
        expect(agent!.temperature).toBe(0.3)
        expect(agent!.prompt).toBeTruthy()
      },
    })
  })

  test("is hidden and excluded from default agent selection", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const name = await Agent.defaultAgent()
        expect(name).not.toBe("enhance")
      },
    })
  })

  test("denies all tool access", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const agent = await Agent.get("enhance")
        const perm = agent!.permission
        expect(PermissionNext.evaluate("read", "any-file.ts", perm).action).toBe("deny")
        expect(PermissionNext.evaluate("edit", "any-file.ts", perm).action).toBe("deny")
        expect(PermissionNext.evaluate("bash", "any-command", perm).action).toBe("deny")
      },
    })
  })
})

describe("enhance agent user config", () => {
  test("model can be overridden via config", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          enhance: {
            model: "anthropic/claude-haiku-4-5",
          },
        },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const agent = await Agent.get("enhance")
        expect(agent!.model).toBeDefined()
        expect(String(agent!.model!.providerID)).toBe("anthropic")
        expect(String(agent!.model!.modelID)).toBe("claude-haiku-4-5")
      },
    })
  })

  test("temperature can be overridden via config", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          enhance: {
            temperature: 0.7,
          },
        },
      },
    })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const agent = await Agent.get("enhance")
        expect(agent!.temperature).toBe(0.7)
      },
    })
  })

  test("without config, no model is set (uses runtime fallback)", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const agent = await Agent.get("enhance")
        expect(agent!.model).toBeUndefined()
      },
    })
  })
})

describe("prompt_enhance keybind", () => {
  test("defaults to <leader>p in the keybinds schema", () => {
    const keybinds = Config.Keybinds.parse({})
    expect(keybinds.prompt_enhance).toBe("<leader>p")
  })

  test("accepts a custom binding", () => {
    const keybinds = Config.Keybinds.parse({ prompt_enhance: "ctrl+e" })
    expect(keybinds.prompt_enhance).toBe("ctrl+e")
  })
})
