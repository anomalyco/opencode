import { afterEach, describe, expect, test } from "bun:test"
import { Bus } from "../../src/bus"
import { CallTrace } from "../../src/session/call-trace"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  CallTrace.clearAll()
  await Instance.disposeAll()
})

describe("OMO trace downstream chain", () => {
  test("Worker pattern: Bus.subscribeAll receives all call-trace events", async () => {
    await using tmp = await tmpdir()
    const received: Array<{ type: string; properties: any }> = []

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const unsub = Bus.subscribeAll((event) => {
          received.push({ type: event.type, properties: event.properties })
        })
        await Bun.sleep(10)

        const traceID = await CallTrace.start({
          type: "omo",
          source: "OMO",
          name: "explore",
          component: "task.execute",
          messageID: "msg_worker_001",
          agentName: "explore",
          description: "Search codebase",
        })
        await Bun.sleep(10)

        await CallTrace.end(traceID, {
          status: "completed",
          output: "Found 5 files",
        })
        await Bun.sleep(10)

        unsub()
      },
    })

    const startEvents = received.filter((e) => e.type === "call-trace.start")
    const endEvents = received.filter((e) => e.type === "call-trace.end")

    expect(startEvents.length).toBe(1)
    expect(endEvents.length).toBe(1)

    expect(startEvents[0].properties.messageID).toBe("msg_worker_001")
    expect(startEvents[0].properties.trace.type).toBe("omo")
    expect(startEvents[0].properties.trace.source).toBe("OMO")
    expect(startEvents[0].properties.trace.agentName).toBe("explore")
    expect(startEvents[0].properties.trace.description).toBe("Search codebase")

    expect(endEvents[0].properties.messageID).toBe("msg_worker_001")
    expect(endEvents[0].properties.traceID).toBe(startEvents[0].properties.trace.id)
    expect(endEvents[0].properties.status).toBe("completed")
    expect(endEvents[0].properties.output).toBe("Found 5 files")
  })

  test("CallTraceProvider store logic: start adds trace, end updates trace", async () => {
    await using tmp = await tmpdir()

    const store: Record<string, any[]> = {}

    function setTraces(messageID: string, updater: (prev: any[]) => any[]) {
      store[messageID] = updater(store[messageID] ?? [])
    }

    function getTraces(messageID: string): any[] {
      return store[messageID] ?? []
    }

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        Bus.subscribeAll((event) => {
          if (event.type === "call-trace.start") {
            const { messageID, trace } = event.properties
            setTraces(messageID, (prev) => {
              const idx = prev.findIndex((t: any) => t.id === trace.id)
              if (idx >= 0) {
                return [...prev.slice(0, idx), trace, ...prev.slice(idx + 1)]
              }
              return [...prev, trace]
            })
          } else if (event.type === "call-trace.end") {
            const { messageID, traceID, endTime, duration, status, output } = event.properties
            setTraces(messageID, (prev) => {
              return prev.map((t: any) => {
                if (t.id !== traceID) return t
                return { ...t, endTime, duration, status, output }
              })
            })
          }
        })
        await Bun.sleep(10)

        const traceID = await CallTrace.start({
          type: "omo",
          source: "OMO",
          name: "librarian",
          component: "task.execute",
          messageID: "msg_store_001",
          agentName: "librarian",
          description: "Find documentation",
        })
        await Bun.sleep(10)

        const runningTraces = getTraces("msg_store_001")
        expect(runningTraces.length).toBe(1)
        expect(runningTraces[0].id).toBe(traceID)
        expect(runningTraces[0].type).toBe("omo")
        expect(runningTraces[0].status).toBe("running")

        await CallTrace.end(traceID, {
          status: "completed",
          output: "Found 10 docs",
        })
        await Bun.sleep(10)

        const completedTraces = getTraces("msg_store_001")
        expect(completedTraces.length).toBe(1)
        expect(completedTraces[0].id).toBe(traceID)
        expect(completedTraces[0].status).toBe("completed")
        expect(completedTraces[0].output).toBe("Found 10 docs")
        expect(completedTraces[0].duration).toBeGreaterThanOrEqual(0)
      },
    })
  })

  test("CallTraceBar data aggregation: allTraces flattens traces from multiple messages", async () => {
    await using tmp = await tmpdir()

    const store: Record<string, any[]> = {}

    function getTraces(messageID: string): any[] {
      return store[messageID] ?? []
    }

    function allTraces(messageIDs: string[]): any[] {
      return messageIDs.flatMap((id) => getTraces(id))
    }

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        Bus.subscribeAll((event) => {
          if (event.type === "call-trace.start") {
            const { messageID, trace } = event.properties
            store[messageID] = [...(store[messageID] ?? []), trace]
          } else if (event.type === "call-trace.end") {
            const { messageID, traceID, status, duration } = event.properties
            if (store[messageID]) {
              store[messageID] = store[messageID].map((t: any) => (t.id === traceID ? { ...t, status, duration } : t))
            }
          }
        })
        await Bun.sleep(10)

        await CallTrace.start({
          type: "omo",
          source: "OMO",
          name: "explore",
          component: "task.execute",
          messageID: "msg_1",
          agentName: "explore",
        })
        await CallTrace.start({
          type: "omo",
          source: "OMO",
          name: "librarian",
          component: "task.execute",
          messageID: "msg_1",
          agentName: "librarian",
        })
        await CallTrace.start({
          type: "tool",
          source: "OC",
          name: "read",
          component: "tool.read",
          messageID: "msg_2",
          toolName: "read",
        })
        await Bun.sleep(10)

        const result = allTraces(["msg_1", "msg_2", "msg_3"])
        expect(result.length).toBe(3)

        const omoTraces = result.filter((t: any) => t.type === "omo")
        const toolTraces = result.filter((t: any) => t.type === "tool")

        expect(omoTraces.length).toBe(2)
        expect(toolTraces.length).toBe(1)

        expect(omoTraces[0].name).toBe("explore")
        expect(omoTraces[1].name).toBe("librarian")
        expect(toolTraces[0].name).toBe("read")
      },
    })
  })

  test("OMO trace with sessionID is preserved through the chain", async () => {
    await using tmp = await tmpdir()
    const traces: any[] = []

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        Bus.subscribeAll((event) => {
          if (event.type === "call-trace.start") {
            traces.push(event.properties.trace)
          }
        })
        await Bun.sleep(10)

        await CallTrace.start({
          type: "omo",
          source: "OMO",
          name: "oracle",
          component: "task.execute",
          messageID: "msg_session_001",
          agentName: "oracle",
          description: "Review architecture",
          sessionID: "ses_subagent_xyz",
        })
        await Bun.sleep(10)
      },
    })

    expect(traces.length).toBe(1)
    expect(traces[0].agentName).toBe("oracle")
    expect(traces[0].description).toBe("Review architecture")
    expect(traces[0].sessionID).toBe("ses_subagent_xyz")
  })

  test("error trace preserves error metadata through the chain", async () => {
    await using tmp = await tmpdir()
    const endEvents: any[] = []

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        Bus.subscribeAll((event) => {
          if (event.type === "call-trace.end") {
            endEvents.push(event.properties)
          }
        })
        await Bun.sleep(10)

        const traceID = await CallTrace.start({
          type: "omo",
          source: "OMO",
          name: "explore",
          component: "task.execute",
          messageID: "msg_err_chain",
          agentName: "explore",
        })
        await Bun.sleep(10)

        await CallTrace.end(traceID, {
          status: "error",
          metadata: { error: "Agent timeout after 30s", retries: 3 },
        })
        await Bun.sleep(10)
      },
    })

    expect(endEvents.length).toBe(1)
    expect(endEvents[0].status).toBe("error")
    expect(endEvents[0].metadata).toEqual({ error: "Agent timeout after 30s", retries: 3 })
  })

  test("trace events are ordered correctly (start before end)", async () => {
    await using tmp = await tmpdir()
    const eventSequence: string[] = []

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        Bus.subscribeAll((event) => {
          if (event.type === "call-trace.start") {
            eventSequence.push(`start:${event.properties.trace.name}`)
          } else if (event.type === "call-trace.end") {
            eventSequence.push(`end:${event.properties.traceID}`)
          }
        })
        await Bun.sleep(10)

        const traceID = await CallTrace.start({
          type: "omo",
          source: "OMO",
          name: "explore",
          component: "task.execute",
          messageID: "msg_order_001",
          agentName: "explore",
        })
        await Bun.sleep(10)

        await CallTrace.end(traceID, { status: "completed" })
        await Bun.sleep(10)
      },
    })

    expect(eventSequence.length).toBe(2)
    expect(eventSequence[0]).toMatch(/^start:explore/)
    expect(eventSequence[1]).toMatch(/^end:trace_/)
  })
})
