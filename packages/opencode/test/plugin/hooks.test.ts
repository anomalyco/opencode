import { test, expect, describe } from "bun:test"
import type { Hooks, PluginInput, Plugin, AuthLoaderResult } from "@opencode-ai/plugin"

describe("plugin SDK types", () => {
  describe("PluginInput.getAuth", () => {
    test("is optional", () => {
      const input: PluginInput = {
        client: {} as any,
        project: {} as any,
        directory: "/tmp",
        worktree: "/tmp",
        serverUrl: new URL("http://localhost:4096"),
        $: {} as any,
      }
      expect(input.getAuth).toBeUndefined()
    })

    test("accepts a function returning Auth", () => {
      const input = {
        client: {} as any,
        project: {} as any,
        directory: "/tmp",
        worktree: "/tmp",
        serverUrl: new URL("http://localhost:4096"),
        getAuth: async () => ({ type: "api" as const, key: "glpat-test" }),
        $: {} as any,
      } satisfies PluginInput
      expect(typeof input.getAuth).toBe("function")
    })

    test("accepts a function returning null", () => {
      const input = {
        client: {} as any,
        project: {} as any,
        directory: "/tmp",
        worktree: "/tmp",
        serverUrl: new URL("http://localhost:4096"),
        getAuth: async () => null,
        $: {} as any,
      } satisfies PluginInput
      expect(typeof input.getAuth).toBe("function")
    })
  })

  describe("Hooks.route", () => {
    test("accepts function form", () => {
      const hooks: Hooks = {
        route: (_app) => {},
      }
      expect(typeof hooks.route).toBe("function")
    })

    test("accepts object form with prefix", () => {
      const hooks: Hooks = {
        route: { prefix: "gitlab", handler: (_app) => {} },
      }
      expect(hooks.route).toBeDefined()
      expect(typeof hooks.route).toBe("object")
      const route = hooks.route as { prefix: string; handler: (app: any) => void }
      expect(route.prefix).toBe("gitlab")
      expect(typeof route.handler).toBe("function")
    })

    test("is optional", () => {
      const hooks: Hooks = {}
      expect(hooks.route).toBeUndefined()
    })
  })

  describe("Hooks.model.select", () => {
    test("accepts async handler with input and output", () => {
      const hooks: Hooks = {
        "model.select": async (input, output) => {
          expect(input.providerID).toBeDefined()
          expect(input.modelID).toBeDefined()
          output.subModel = "claude_4"
          output.displayName = "Claude 4"
        },
      }
      expect(typeof hooks["model.select"]).toBe("function")
    })

    test("input has optional sessionID", () => {
      const hooks: Hooks = {
        "model.select": async (input, _output) => {
          void input.sessionID
        },
      }
      expect(hooks["model.select"]).toBeDefined()
    })

    test("is optional", () => {
      const hooks: Hooks = {}
      expect(hooks["model.select"]).toBeUndefined()
    })
  })

  describe("AuthLoaderResult", () => {
    test("extends Record<string, any>", () => {
      const result: AuthLoaderResult = {
        foo: "bar",
        num: 42,
      }
      expect(result.foo).toBe("bar")
    })

    test("has optional getModel", () => {
      const result: AuthLoaderResult = {}
      expect(result.getModel).toBeUndefined()
    })

    test("getModel accepts sdk, modelID, options", () => {
      const result: AuthLoaderResult = {
        getModel: (sdk, modelID, options) => {
          return { sdk, modelID, options }
        },
      }
      const model = result.getModel!({}, "test-model", { temperature: 0.5 })
      expect(model.modelID).toBe("test-model")
    })
  })

  describe("Plugin function", () => {
    test("can return hooks with route and model.select", async () => {
      const plugin: Plugin = async (_input) => ({
        route: { prefix: "test", handler: () => {} },
        "model.select": async (_input, output) => {
          output.displayName = "Test"
        },
      })
      const hooks = await plugin({
        client: {} as any,
        project: {} as any,
        directory: "/tmp",
        worktree: "/tmp",
        serverUrl: new URL("http://localhost:4096"),
        $: {} as any,
      })
      expect(hooks.route).toBeDefined()
      expect(hooks["model.select"]).toBeDefined()
    })

    test("can return hooks without new fields (backward compat)", async () => {
      const plugin: Plugin = async (_input) => ({
        auth: {
          provider: "test",
          methods: [],
        },
      })
      const hooks = await plugin({
        client: {} as any,
        project: {} as any,
        directory: "/tmp",
        worktree: "/tmp",
        serverUrl: new URL("http://localhost:4096"),
        $: {} as any,
      })
      expect(hooks.auth?.provider).toBe("test")
      expect(hooks.route).toBeUndefined()
      expect(hooks["model.select"]).toBeUndefined()
    })
  })
})
