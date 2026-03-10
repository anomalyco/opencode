import { test, expect, describe } from "bun:test"
import type { Hooks } from "@opencode-ai/plugin"

describe("plugin trigger type constraints", () => {
  test("route is excluded from triggerable hooks", () => {
    type TriggerableHooks = Exclude<keyof Required<Hooks>, "auth" | "event" | "tool" | "route">
    const allowed: TriggerableHooks[] = [
      "config",
      "chat.message",
      "chat.params",
      "chat.headers",
      "permission.ask",
      "command.execute.before",
      "tool.execute.before",
      "shell.env",
      "tool.execute.after",
      "experimental.chat.messages.transform",
      "experimental.chat.system.transform",
      "experimental.session.compacting",
      "experimental.text.complete",
      "tool.definition",
      "model.select",
    ]
    expect(allowed).toContain("model.select")
    // @ts-expect-error route should not be assignable to TriggerableHooks
    const _bad: TriggerableHooks = "route"
    void _bad
  })

  test("model.select is a callable hook", () => {
    type TriggerableHooks = Exclude<keyof Required<Hooks>, "auth" | "event" | "tool" | "route">
    const name: TriggerableHooks = "model.select"
    type Fn = Required<Hooks>[typeof name]
    const fn: Fn = async (input, output) => {
      output.subModel = "test"
      output.displayName = input.modelID
    }
    expect(typeof fn).toBe("function")
  })

  test("model.select hook mutates output", async () => {
    const hook: Required<Hooks>["model.select"] = async (_input, output) => {
      output.subModel = "claude_4"
      output.displayName = "Claude 4"
    }
    const output: { subModel?: string; displayName?: string } = {}
    await hook({ providerID: "gitlab", modelID: "duo_workflow" }, output)
    expect(output.subModel).toBe("claude_4")
    expect(output.displayName).toBe("Claude 4")
  })

  test("route hook object form has correct shape", () => {
    const hooks: Hooks = {
      route: {
        prefix: "gitlab",
        handler: (app: any) => {
          app.get("/test", () => {})
        },
      },
    }
    const route = hooks.route as { prefix: string; handler: (app: any) => void }
    expect(route.prefix).toBe("gitlab")
    const calls: string[] = []
    route.handler({ get: (path: string) => calls.push(path) })
    expect(calls).toEqual(["/test"])
  })

  test("multiple hooks chain model.select output", async () => {
    const hook1: Required<Hooks>["model.select"] = async (_input, output) => {
      output.subModel = "first"
    }
    const hook2: Required<Hooks>["model.select"] = async (_input, output) => {
      if (!output.subModel) output.subModel = "second"
      output.displayName = `Model: ${output.subModel}`
    }
    const output: { subModel?: string; displayName?: string } = {}
    const input = { providerID: "gitlab", modelID: "duo_workflow" }
    await hook1(input, output)
    await hook2(input, output)
    expect(output.subModel).toBe("first")
    expect(output.displayName).toBe("Model: first")
  })

  test("model.select with no-op hook preserves empty output", async () => {
    const hook: Required<Hooks>["model.select"] = async () => {}
    const output: { subModel?: string; displayName?: string } = {}
    await hook({ providerID: "openai", modelID: "gpt-4" }, output)
    expect(output.subModel).toBeUndefined()
    expect(output.displayName).toBeUndefined()
  })
})
