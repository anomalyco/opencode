import { test, expect, mock } from "bun:test"
import { tmpdir } from "../fixture/fixture"

const pluginModulePath = new URL("../../src/plugin/index.ts", import.meta.url).pathname

let pluginHook: Record<string, any> = {}
const executeCalls: Array<Record<string, unknown>> = []
const fakeClient = {
  tui: {
    publish: async () => {},
  },
}

mock.module(pluginModulePath, () => ({
  Plugin: {
    list: async () => [pluginHook],
    client: async () => fakeClient,
    trigger: async (_name: string, _input: unknown, output: unknown) => output,
  },
}))

const { Instance } = await import("../../src/project/instance")
const { Session } = await import("../../src/session")
const { SessionPrompt } = await import("../../src/session/prompt")
const { Command } = await import("../../src/command")
const { Bus } = await import("../../src/bus")
const { Identifier } = await import("../../src/id/id")

async function withInstance(fn: () => Promise<void>) {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await fn()
      await Instance.dispose()
    },
  })
}

test("Command.get resolves plugin aliases", async () => {
  pluginHook = {
    "plugin.command": {
      hello: {
        description: "hello",
        aliases: ["hi"],
        sessionOnly: false,
        execute: async () => {},
      },
    },
  }

  await withInstance(async () => {
    const cmd = await Command.get("hi")
    expect(cmd?.name).toBe("hello")
    expect(cmd?.type).toBe("plugin")
  })
})

test("SessionPrompt.command executes plugin command", async () => {
  executeCalls.length = 0
  pluginHook = {
    "plugin.command": {
      hello: {
        description: "hello",
        sessionOnly: false,
        execute: async (input: { sessionID: string; arguments: string }) => {
          executeCalls.push(input)
        },
      },
    },
  }

  await withInstance(async () => {
    const session = await Session.create({})
    await SessionPrompt.command({
      sessionID: session.id,
      command: "hello",
      arguments: "world",
    })
    expect(executeCalls.length).toBe(1)
    expect(executeCalls[0].arguments).toBe("world")
  })
})

test("SessionPrompt.command publishes error on plugin failure", async () => {
  pluginHook = {
    "plugin.command": {
      boom: {
        description: "boom",
        sessionOnly: false,
        execute: async () => {
          throw new Error("boom")
        },
      },
    },
  }

  await withInstance(async () => {
    const session = await Session.create({})
    const errors: Array<{ type: string; properties: any }> = []
    const unsubscribe = Bus.subscribe(Session.Event.Error, (event) => {
      errors.push(event)
    })

    await expect(
      SessionPrompt.command({
        sessionID: session.id,
        command: "boom",
        arguments: "",
      }),
    ).rejects.toThrow("boom")

    await new Promise((resolve) => setTimeout(resolve, 0))
    unsubscribe()

    expect(errors.length).toBe(1)
    expect(JSON.stringify(errors[0].properties.error)).toContain("/boom failed")
  })
})

test("SessionPrompt.command blocks session-only commands for missing sessions", async () => {
  executeCalls.length = 0
  pluginHook = {
    "plugin.command": {
      hello: {
        description: "hello",
        sessionOnly: true,
        execute: async (input: { sessionID: string; arguments: string }) => {
          executeCalls.push(input)
        },
      },
    },
  }

  await withInstance(async () => {
    const missingSessionID = Identifier.ascending("session")
    const errors: Array<{ type: string; properties: any }> = []
    const unsubscribe = Bus.subscribe(Session.Event.Error, (event) => {
      errors.push(event)
    })

    await expect(
      SessionPrompt.command({
        sessionID: missingSessionID,
        command: "hello",
        arguments: "",
      }),
    ).rejects.toThrow("requires an existing session")

    await new Promise((resolve) => setTimeout(resolve, 0))
    unsubscribe()

    expect(executeCalls.length).toBe(0)
    expect(errors.length).toBe(1)
    expect(JSON.stringify(errors[0].properties.error)).toContain("/hello requires an existing session")
  })
})
