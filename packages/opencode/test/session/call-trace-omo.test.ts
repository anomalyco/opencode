import { afterEach, describe, expect, test } from "bun:test"
import { Bus } from "../../src/bus"
import { CallTrace } from "../../src/session/call-trace"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  CallTrace.clearAll()
  await Instance.disposeAll()
})

describe("CallTrace OMO", () => {
  test("CallTrace.start publishes call-trace.start event with type=omo and source=OMO", async () => {
    await using tmp = await tmpdir()
    const received: Array<{ type: string; trace: any }> = []

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        Bus.subscribeAll((evt) => {
          if (evt.type === "call-trace.start") {
            received.push({ type: evt.type, trace: evt.properties.trace })
          }
        })
        await Bun.sleep(10)

        await CallTrace.start({
          type: "omo",
          source: "OMO",
          name: "explore",
          component: "task.execute",
          messageID: "msg_test_123",
          agentName: "explore",
          description: "Searching codebase",
        })
        await Bun.sleep(10)
      },
    })

    expect(received.length).toBe(1)
    expect(received[0].type).toBe("call-trace.start")
    expect(received[0].trace.type).toBe("omo")
    expect(received[0].trace.source).toBe("OMO")
    expect(received[0].trace.name).toBe("explore")
    expect(received[0].trace.agentName).toBe("explore")
    expect(received[0].trace.description).toBe("Searching codebase")
    expect(received[0].trace.status).toBe("running")
  })

  test("CallTrace.start defaults source to OMO when type is omo", async () => {
    await using tmp = await tmpdir()
    const received: Array<{ trace: any }> = []

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        Bus.subscribeAll((evt) => {
          if (evt.type === "call-trace.start") {
            received.push({ trace: evt.properties.trace })
          }
        })
        await Bun.sleep(10)

        await CallTrace.start({
          type: "omo",
          name: "general",
          component: "task.execute",
          messageID: "msg_test_456",
          agentName: "general",
        })
        await Bun.sleep(10)
      },
    })

    expect(received.length).toBe(1)
    expect(received[0].trace.source).toBe("OMO")
    expect(received[0].trace.type).toBe("omo")
  })

  test("CallTrace.end publishes call-trace.end event with correct fields", async () => {
    await using tmp = await tmpdir()
    const received: Array<{ type: string; props: any }> = []

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        Bus.subscribeAll((evt) => {
          if (evt.type === "call-trace.start" || evt.type === "call-trace.end") {
            received.push({ type: evt.type, props: evt.properties })
          }
        })
        await Bun.sleep(10)

        const traceID = await CallTrace.start({
          type: "omo",
          source: "OMO",
          name: "librarian",
          component: "task.execute",
          messageID: "msg_test_789",
          agentName: "librarian",
          description: "Finding docs",
        })
        await Bun.sleep(10)

        await CallTrace.end(traceID, {
          status: "completed",
          metadata: { resultCount: 5 },
        })
        await Bun.sleep(10)
      },
    })

    const startEvent = received.find((e) => e.type === "call-trace.start")
    const endEvent = received.find((e) => e.type === "call-trace.end")

    expect(startEvent).toBeDefined()
    expect(endEvent).toBeDefined()

    expect(endEvent!.props.messageID).toBe("msg_test_789")
    expect(endEvent!.props.traceID).toBe(startEvent!.props.trace.id)
    expect(endEvent!.props.status).toBe("completed")
    expect(endEvent!.props.duration).toBeGreaterThanOrEqual(0)
  })

  test("CallTrace.end with error status preserves error metadata", async () => {
    await using tmp = await tmpdir()
    const endEvents: any[] = []

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        Bus.subscribeAll((evt) => {
          if (evt.type === "call-trace.end") {
            endEvents.push(evt.properties)
          }
        })
        await Bun.sleep(10)

        const traceID = await CallTrace.start({
          type: "omo",
          source: "OMO",
          name: "explore",
          component: "task.execute",
          messageID: "msg_err_001",
          agentName: "explore",
        })
        await Bun.sleep(10)

        await CallTrace.end(traceID, {
          status: "error",
          metadata: { error: "Agent timeout" },
        })
        await Bun.sleep(10)
      },
    })

    expect(endEvents.length).toBe(1)
    expect(endEvents[0].status).toBe("error")
    expect(endEvents[0].metadata).toEqual({ error: "Agent timeout" })
  })

  test("OMO trace fields match CallTraceItem interface", async () => {
    await using tmp = await tmpdir()
    const traces: any[] = []

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        Bus.subscribeAll((evt) => {
          if (evt.type === "call-trace.start") {
            traces.push(evt.properties.trace)
          }
        })
        await Bun.sleep(10)

        await CallTrace.start({
          type: "omo",
          source: "OMO",
          name: "oracle",
          component: "task.execute",
          messageID: "msg_iface_001",
          agentName: "oracle",
          description: "Architecture review",
          sessionID: "ses_subagent_123",
        })
        await Bun.sleep(10)
      },
    })

    const trace = traces[0]

    expect(trace.id).toMatch(/^trace_\d+_\d+$/)
    expect(trace.type).toBe("omo")
    expect(trace.source).toBe("OMO")
    expect(trace.name).toBe("oracle")
    expect(trace.component).toBe("task.execute")
    expect(trace.startTime).toBeGreaterThan(0)
    expect(trace.status).toBe("running")
    expect(trace.agentName).toBe("oracle")
    expect(trace.description).toBe("Architecture review")
    expect(trace.sessionID).toBe("ses_subagent_123")
  })

  test("multiple OMO traces can coexist", async () => {
    await using tmp = await tmpdir()
    const startEvents: any[] = []

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        Bus.subscribeAll((evt) => {
          if (evt.type === "call-trace.start") {
            startEvents.push(evt.properties)
          }
        })
        await Bun.sleep(10)

        const id1 = await CallTrace.start({
          type: "omo",
          source: "OMO",
          name: "explore",
          component: "task.execute",
          messageID: "msg_multi_1",
          agentName: "explore",
        })
        const id2 = await CallTrace.start({
          type: "omo",
          source: "OMO",
          name: "librarian",
          component: "task.execute",
          messageID: "msg_multi_2",
          agentName: "librarian",
        })
        await Bun.sleep(10)

        expect(id1).not.toBe(id2)
      },
    })

    expect(startEvents.length).toBe(2)
    expect(startEvents[0].trace.name).toBe("explore")
    expect(startEvents[1].trace.name).toBe("librarian")
    expect(startEvents[0].messageID).toBe("msg_multi_1")
    expect(startEvents[1].messageID).toBe("msg_multi_2")
  })
})
