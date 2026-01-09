import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Plugin } from "../../src/plugin"
import { Command } from "../../src/command"
import { Log } from "../../src/util/log"
import { Identifier } from "../../src/id/id"

Log.init({ print: false })

const projectRoot = path.join(__dirname, "../..")

describe("ralph-wiggum plugin", () => {
  test("ralph-loop command is registered and stop hook is available", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        // Initialize plugins
        await Plugin.init()

        // List plugins to verify ralph-wiggum is loaded
        const plugins = await Plugin.list()

        // Check that the session.stop hook is available
        const hasStopHook = plugins.some((p: any) => typeof p["session.stop"] === "function")
        expect(hasStopHook).toBe(true)

        // Check that ralph-loop command is available
        const commands = await Command.list()
        const hasRalphLoopCommand = commands.some((c) => c.name === "ralph-loop")
        expect(hasRalphLoopCommand).toBe(true)

        // Check that cancel-ralph command is available
        const hasCancelRalphCommand = commands.some((c) => c.name === "cancel-ralph")
        expect(hasCancelRalphCommand).toBe(true)

        // Check that ralph-status command is available
        const hasRalphStatusCommand = commands.some((c) => c.name === "ralph-status")
        expect(hasRalphStatusCommand).toBe(true)

        // Check that cancel-ralph tool is still available (for programmatic cancellation)
        const hasCancelRalphTool = plugins.some((p: any) => p.tool?.["cancel-ralph"] !== undefined)
        expect(hasCancelRalphTool).toBe(true)

        // Check that ralph-status tool is available
        const hasRalphStatusTool = plugins.some((p: any) => p.tool?.["ralph-status"] !== undefined)
        expect(hasRalphStatusTool).toBe(true)
      },
    })
  }, 30000)

  test("stop hook sets stop: false then stop: true when max iterations reached", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        await Plugin.init()
        const plugins = await Plugin.list()

        // Find the ralph plugin
        const ralphPlugin = plugins.find((p: any) => typeof p["session.stop"] === "function") as any
        expect(ralphPlugin).toBeDefined()

        // Create a mock session
        const session = await Session.create({})

        // Simulate command execution by triggering the event hook
        // This is how the plugin sets up its state
        if (ralphPlugin.event) {
          await ralphPlugin.event({
            event: {
              type: "command.executed",
              properties: {
                name: "ralph-loop",
                sessionID: session.id,
                arguments: "test prompt --max 2",
                messageID: Identifier.ascending("message"),
              },
            },
          })
        }

        // Get the stop hook (synchronous)
        const stopHook = ralphPlugin["session.stop"] as (
          input: { sessionID: string; step: number },
          output: { stop: boolean },
        ) => void

        // First iteration - should set stop: false
        const output1 = { stop: true }
        stopHook({ sessionID: session.id, step: 1 }, output1)
        expect(output1.stop).toBe(false)

        // Second iteration - should set stop: true (max reached)
        const output2 = { stop: true }
        stopHook({ sessionID: session.id, step: 2 }, output2)
        expect(output2.stop).toBe(true)

        await Session.remove(session.id)
      },
    })
  }, 30000)

  test("cancel-ralph tool stops the loop", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        await Plugin.init()
        const plugins = await Plugin.list()

        const ralphPlugin = plugins.find((p: any) => typeof p["session.stop"] === "function") as any
        expect(ralphPlugin).toBeDefined()

        const session = await Session.create({})

        const mockCtx = {
          sessionID: session.id,
          messageID: Identifier.ascending("message"),
          agent: "build",
          abort: new AbortController().signal,
        }

        // Simulate command execution
        if (ralphPlugin.event) {
          await ralphPlugin.event({
            event: {
              type: "command.executed",
              properties: {
                name: "ralph-loop",
                sessionID: session.id,
                arguments: "test prompt --max 100",
                messageID: mockCtx.messageID,
              },
            },
          })
        }

        // Get the stop hook (synchronous)
        const stopHook = ralphPlugin["session.stop"] as (
          input: { sessionID: string; step: number },
          output: { stop: boolean },
        ) => void

        // First iteration - should set stop: false (loop active)
        const output1 = { stop: true }
        stopHook({ sessionID: session.id, step: 1 }, output1)
        expect(output1.stop).toBe(false)

        // Cancel the loop using the tool
        const cancelRalphTool = ralphPlugin.tool["cancel-ralph"]
        await cancelRalphTool.execute({}, mockCtx)

        // After cancel - should leave stop: true (no active loop)
        const output2 = { stop: true }
        stopHook({ sessionID: session.id, step: 2 }, output2)
        expect(output2.stop).toBe(true)

        await Session.remove(session.id)
      },
    })
  }, 30000)

  test("stop hook detects completion promise and stops loop", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        await Plugin.init()
        const plugins = await Plugin.list()

        const ralphPlugin = plugins.find((p: any) => typeof p["session.stop"] === "function") as any
        expect(ralphPlugin).toBeDefined()

        const session = await Session.create({})

        // Simulate command execution with a completion promise
        if (ralphPlugin.event) {
          await ralphPlugin.event({
            event: {
              type: "command.executed",
              properties: {
                name: "ralph-loop",
                sessionID: session.id,
                arguments: "test prompt --max 100 --promise DONE",
                messageID: Identifier.ascending("message"),
              },
            },
          })
        }

        // Get the stop hook (synchronous)
        const stopHook = ralphPlugin["session.stop"] as (
          input: { sessionID: string; step: number; lastAssistantText?: string },
          output: { stop: boolean; prompt?: string; systemMessage?: string },
        ) => void

        // First iteration without promise - should continue
        const output1: { stop: boolean; prompt?: string; systemMessage?: string } = { stop: true }
        stopHook({ sessionID: session.id, step: 1, lastAssistantText: "I'm working on it..." }, output1)
        expect(output1.stop).toBe(false)
        expect(output1.prompt).toBe("test prompt")
        expect(output1.systemMessage).toContain("Ralph iteration")

        // Second iteration with promise in response - should stop
        const output2: { stop: boolean; prompt?: string; systemMessage?: string } = { stop: true }
        stopHook(
          { sessionID: session.id, step: 2, lastAssistantText: "Task complete! <promise>DONE</promise>" },
          output2,
        )
        expect(output2.stop).toBe(true)

        await Session.remove(session.id)
      },
    })
  }, 30000)

  test("stop hook feeds back original prompt on each iteration", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        await Plugin.init()
        const plugins = await Plugin.list()

        const ralphPlugin = plugins.find((p: any) => typeof p["session.stop"] === "function") as any
        expect(ralphPlugin).toBeDefined()

        const session = await Session.create({})

        // Simulate command execution with specific prompt
        if (ralphPlugin.event) {
          await ralphPlugin.event({
            event: {
              type: "command.executed",
              properties: {
                name: "ralph-loop",
                sessionID: session.id,
                arguments: "Build a hello world app --max 5",
                messageID: Identifier.ascending("message"),
              },
            },
          })
        }

        const stopHook = ralphPlugin["session.stop"] as (
          input: { sessionID: string; step: number; lastAssistantText?: string },
          output: { stop: boolean; prompt?: string; systemMessage?: string },
        ) => void

        // Each iteration should get back the same original prompt
        const output1: { stop: boolean; prompt?: string; systemMessage?: string } = { stop: true }
        stopHook({ sessionID: session.id, step: 1, lastAssistantText: "Working..." }, output1)
        expect(output1.stop).toBe(false)
        expect(output1.prompt).toBe("Build a hello world app")
        expect(output1.systemMessage).toContain("[Ralph iteration 2/5]")

        const output2: { stop: boolean; prompt?: string; systemMessage?: string } = { stop: true }
        stopHook({ sessionID: session.id, step: 2, lastAssistantText: "Still working..." }, output2)
        expect(output2.stop).toBe(false)
        expect(output2.prompt).toBe("Build a hello world app")
        expect(output2.systemMessage).toContain("[Ralph iteration 3/5]")

        await Session.remove(session.id)
      },
    })
  }, 30000)

  test("ralph-status tool returns loop status", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        await Plugin.init()
        const plugins = await Plugin.list()

        const ralphPlugin = plugins.find((p: any) => typeof p["session.stop"] === "function") as any
        expect(ralphPlugin).toBeDefined()

        const session = await Session.create({})

        const mockCtx = {
          sessionID: session.id,
          messageID: Identifier.ascending("message"),
          agent: "build",
          abort: new AbortController().signal,
        }

        // Check status when no loop is active
        const ralphStatusTool = ralphPlugin.tool["ralph-status"]
        const noLoopStatus = await ralphStatusTool.execute({}, mockCtx)
        expect(noLoopStatus).toBe("No active Ralph loop")

        // Start a loop
        if (ralphPlugin.event) {
          await ralphPlugin.event({
            event: {
              type: "command.executed",
              properties: {
                name: "ralph-loop",
                sessionID: session.id,
                arguments: "Build a feature --max 10 --promise COMPLETE",
                messageID: mockCtx.messageID,
              },
            },
          })
        }

        // Trigger one iteration
        const stopHook = ralphPlugin["session.stop"] as (
          input: { sessionID: string; step: number; lastAssistantText?: string },
          output: { stop: boolean; prompt?: string; systemMessage?: string },
        ) => void
        const output = { stop: true }
        stopHook({ sessionID: session.id, step: 1, lastAssistantText: "Working..." }, output)

        // Now check status
        const activeStatus = await ralphStatusTool.execute({}, mockCtx)
        const status = JSON.parse(activeStatus)
        expect(status.active).toBe(true)
        expect(status.prompt).toBe("Build a feature")
        expect(status.promise).toBe("COMPLETE")
        expect(status.iterations).toBe(1)
        expect(status.max).toBe(10)
        expect(status.remaining).toBe(9)

        await Session.remove(session.id)
      },
    })
  }, 30000)

  test("quoted strings are parsed correctly", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        await Plugin.init()
        const plugins = await Plugin.list()

        const ralphPlugin = plugins.find((p: any) => typeof p["session.stop"] === "function") as any
        expect(ralphPlugin).toBeDefined()

        const session = await Session.create({})

        // Start a loop with a quoted prompt containing spaces
        if (ralphPlugin.event) {
          await ralphPlugin.event({
            event: {
              type: "command.executed",
              properties: {
                name: "ralph-loop",
                sessionID: session.id,
                arguments: '"Build a complex multi-word feature" --max 3 --promise "TASK DONE"',
                messageID: Identifier.ascending("message"),
              },
            },
          })
        }

        // Check status to verify parsing
        const ralphStatusTool = ralphPlugin.tool["ralph-status"]
        const mockCtx = {
          sessionID: session.id,
          messageID: Identifier.ascending("message"),
          agent: "build",
          abort: new AbortController().signal,
        }

        // First trigger a hook call to ensure state is active
        const stopHook = ralphPlugin["session.stop"] as (
          input: { sessionID: string; step: number; lastAssistantText?: string },
          output: { stop: boolean; prompt?: string; systemMessage?: string },
        ) => void
        const output: { stop: boolean; prompt?: string } = { stop: true }
        stopHook({ sessionID: session.id, step: 1 }, output)

        // Verify the prompt was parsed correctly (quotes stripped, spaces preserved)
        expect(output.prompt).toBe("Build a complex multi-word feature")

        await Session.remove(session.id)
      },
    })
  }, 30000)
})
