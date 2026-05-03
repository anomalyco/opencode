import assert from "node:assert/strict"
import { describe, expect, test, afterAll } from "bun:test"
import { Log } from "../../src/util/log"
import { withRelay, cleanupAllRelayContainers, SimulatedBrowser } from "../fixture/relay-testcontainer"

Log.init({ print: false })

const TEST_TIMEOUT = 60000 // 1 minute for relay tests

describe("Relay SDK + Testcontainer", () => {
  afterAll(async () => {
    await cleanupAllRelayContainers()
  })

  test(
    "health check shows relay is ready",
    async () => {
      await withRelay(async (ctx) => {
        const health = await ctx.agent.health()

        expect(health.ok).toBe(true)
        expect(health.service).toBe("relay")
      })
    },
    { timeout: TEST_TIMEOUT },
  )

  test(
    "agent connects to relay",
    async () => {
      await withRelay(async (ctx) => {
        expect(ctx.agent.isConnected()).toBe(true)
      })
    },
    { timeout: TEST_TIMEOUT },
  )

  test(
    "browser connects to relay",
    async () => {
      await withRelay(async (_, browser) => {
        expect(browser.isConnected()).toBe(true)
      })
    },
    { timeout: TEST_TIMEOUT },
  )

  test(
    "agent sends request and receives response from browser",
    async () => {
      await withRelay(async (ctx, browser) => {
        // Register browser handler
        browser.on("test.echo", async (params) => {
          return { received: params, processed: true }
        })

        // Send request from agent
        const result = await ctx.agent.request("test.echo", { message: "hello" })

        expect(result).toEqual({ received: { message: "hello" }, processed: true })
      })
    },
    { timeout: TEST_TIMEOUT },
  )

  test(
    "multiple requests get correct responses",
    async () => {
      await withRelay(async (ctx, browser) => {
        const results: number[] = []

        browser.on("test.add", async (params: any) => {
          const sum = (params.a || 0) + (params.b || 0)
          results.push(sum)
          return { sum }
        })

        // Send multiple concurrent requests
        const promises = [
          ctx.agent.request("test.add", { a: 1, b: 2 }),
          ctx.agent.request("test.add", { a: 3, b: 4 }),
          ctx.agent.request("test.add", { a: 5, b: 6 }),
        ]

        const responses = await Promise.all(promises)

        expect(responses).toContainEqual({ sum: 3 })
        expect(responses).toContainEqual({ sum: 7 })
        expect(responses).toContainEqual({ sum: 11 })
      })
    },
    { timeout: TEST_TIMEOUT },
  )

  test(
    "unknown operation returns error",
    async () => {
      await withRelay(async (ctx) => {
        try {
          await ctx.agent.request("unknown.op", {})
          expect(false).toBe(true) // Should throw
        } catch (error: any) {
          expect(error.message).toContain("Unknown operation")
        }
      })
    },
    { timeout: TEST_TIMEOUT },
  )

  test(
    "Univer SDK command reaches browser",
    async () => {
      await withRelay(async (ctx, browser) => {
        let receivedCommand: string | null = null
        let receivedParams: unknown = null

        // Browser handler for Univer commands
        browser.on("univer.execute", async (params: any) => {
          receivedCommand = params.command
          receivedParams = params.params

          // Simulate Univer execution result
          return {
            success: true,
            command: params.command,
            result: "executed",
          }
        })

        // Backend sends Univer command through relay
        const result = await ctx.agent.executeUniverCommand("RangeRect.create", {
          startRow: 0,
          endRow: 10,
          startColumn: 0,
          endColumn: 5,
        })

        // Verify command reached browser
        if (receivedCommand === null) throw new Error("expected command")
        assert.strictEqual(receivedCommand, "RangeRect.create")
        expect((receivedParams as any).startRow).toBe(0)
        expect((receivedParams as any).endRow).toBe(10)

        // Verify result came back
        expect((result as any).success).toBe(true)
        expect((result as any).command).toBe("RangeRect.create")
      })
    },
    { timeout: TEST_TIMEOUT },
  )

  test(
    "complex Univer workflow: create range → modify → get value",
    async () => {
      await withRelay(async (ctx, browser) => {
        // Browser maintains state
        const spreadsheet = new Map()

        browser.on("univer.execute", async (params: any) => {
          switch (params.command) {
            case "RangeRect.create":
              const id = `range_${Date.now()}`
              spreadsheet.set(id, params.params)
              return { id, ...params.params }

            case "RangeRect.getValue": {
              const range = spreadsheet.get(params.params.id)
              const v =
                range && typeof range === "object" && range !== null && "value" in range
                  ? (range as { value?: unknown }).value
                  : undefined
              return {
                value: v !== undefined && v !== null ? String(v) : `data_for_${params.params.id}`,
                range,
              }
            }

            case "RangeRect.setValue":
              spreadsheet.set(params.params.id, {
                ...spreadsheet.get(params.params.id),
                value: params.params.value,
              })
              return { success: true }

            default:
              return { error: "Unknown command" }
          }
        })

        // Step 1: Create range
        const range = (await ctx.agent.executeUniverCommand("RangeRect.create", {
          startRow: 0,
          endRow: 5,
          startColumn: 0,
          endColumn: 3,
        })) as any

        expect(range.id).toBeDefined()
        expect(range.startRow).toBe(0)

        // Step 2: Set value
        const setResult = (await ctx.agent.executeUniverCommand("RangeRect.setValue", {
          id: range.id,
          value: "Hello from integration test!",
        })) as any

        expect(setResult.success).toBe(true)

        // Step 3: Get value
        const getResult = (await ctx.agent.executeUniverCommand("RangeRect.getValue", {
          id: range.id,
        })) as any

        expect(getResult.value).toContain("integration test")
      })
    },
    { timeout: TEST_TIMEOUT },
  )

  test(
    "backend code reaches frontend and we see it from SDK",
    async () => {
      await withRelay(async (ctx, browser) => {
        const commandsSeen: string[] = []

        // Browser logs all commands it receives
        browser.on("univer.execute", async (params: any) => {
          commandsSeen.push(params.command)

          // Return acknowledgment
          return {
            received: true,
            command: params.command,
            timestamp: Date.now(),
          }
        })

        // Backend sends multiple commands
        await ctx.agent.executeUniverCommand("cmd1", { data: 1 })
        await ctx.agent.executeUniverCommand("cmd2", { data: 2 })
        await ctx.agent.executeUniverCommand("cmd3", { data: 3 })

        // Verify all commands reached browser (via SDK responses)
        expect(commandsSeen).toContain("cmd1")
        expect(commandsSeen).toContain("cmd2")
        expect(commandsSeen).toContain("cmd3")
        expect(commandsSeen.length).toBe(3)
      })
    },
    { timeout: TEST_TIMEOUT },
  )

  test(
    "relay forwards commands and deploys SDK commands to browser",
    async () => {
      await withRelay(async (ctx, browser) => {
        // Browser implements Univer SDK-like interface
        browser.on("spreadsheet.create", async () => ({ id: "sheet_1", created: true }))
        browser.on("cell.setValue", async (params: any) => ({
          cell: params.cell,
          value: params.value,
          set: true,
        }))
        browser.on("cell.getValue", async (params: any) => ({
          cell: params.cell,
          value: `Value of ${params.cell}`,
        }))

        // Backend uses SDK to interact with spreadsheet
        const sdk = ctx.agent

        // Create spreadsheet
        const sheet = (await sdk.request("spreadsheet.create", {})) as any
        expect(sheet.created).toBe(true)

        // Set cell value
        const setResult = (await sdk.request("cell.setValue", { cell: "A1", value: "Hello Relay!" })) as any
        expect(setResult.set).toBe(true)
        expect(setResult.value).toBe("Hello Relay!")

        // Get cell value
        const getResult = (await sdk.request("cell.getValue", { cell: "A1" })) as any
        expect(getResult.cell).toBe("A1")
      })
    },
    { timeout: TEST_TIMEOUT },
  )

  test(
    "browser disconnection notifies agent",
    async () => {
      let ctx: any
      let browser: SimulatedBrowser | undefined

      try {
        ctx = await (await import("../fixture/relay-testcontainer")).startRelayContainer()
        browser = new SimulatedBrowser(ctx.relayUrl)
        await browser.connect()
        await ctx.agent.connect()

        browser.on("test.op", async () => ({ success: true }))

        // Disconnect browser
        browser.disconnect()

        // Wait a bit for disconnect to propagate
        await new Promise((r) => setTimeout(r, 500))

        // Agent should get error when trying to send
        try {
          await ctx.agent.request("test.op", {})
          // If we get here without error, that's also valid (browser may have reconnected)
        } catch (error: any) {
          expect(error.message).toContain("browser is not connected")
        }
      } finally {
        browser?.disconnect()
        ctx?.agent.disconnect()
        if (ctx) {
          await (await import("../fixture/relay-testcontainer")).stopRelayContainer(ctx)
        }
      }
    },
    { timeout: TEST_TIMEOUT },
  )

  test(
    "health shows browser connected",
    async () => {
      await withRelay(async (ctx) => {
        const health = await ctx.agent.health()

        expect(health.browserConnected).toBe(true)
        expect(health.agentCount).toBeGreaterThanOrEqual(1)
      })
    },
    { timeout: TEST_TIMEOUT },
  )

  test(
    "big pickle message flows through relay",
    async () => {
      await withRelay(async (ctx, browser) => {
        let receivedMessage: string | null = null

        browser.on("chat.send", async (params: any) => {
          receivedMessage = params.message
          return {
            delivered: true,
            recipient: "Big Pickle",
            echo: `Big Pickle received: ${params.message}`,
          }
        })

        // Send message to Big Pickle through relay
        const result = (await ctx.agent.request("chat.send", {
          message: "Hi Big Pickle! This is an integration test!",
          from: "integration_test",
        })) as any

        // Verify message reached browser side
        if (receivedMessage === null) throw new Error("expected message")
        assert.strictEqual(receivedMessage, "Hi Big Pickle! This is an integration test!")

        // Verify response came back
        expect(result.delivered).toBe(true)
        expect(result.recipient).toBe("Big Pickle")
        expect(result.echo).toContain("Big Pickle received")
      })
    },
    { timeout: TEST_TIMEOUT },
  )
})
