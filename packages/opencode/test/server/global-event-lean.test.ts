import { afterEach, describe, expect, test } from "bun:test"
import { GlobalBus } from "../../src/bus/global"
import { Server } from "../../src/server/server"
import { MessageV2 } from "../../src/session/message-v2"
import { OMIT_SYNC_EVENTS_HEADER } from "../../src/server/routes/instance/httpapi/handlers/global"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances } from "../fixture/fixture"

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

const url = "data:image/png;base64," + "A".repeat(1_000)
const part = {
  id: "prt_read",
  sessionID: "ses_lean",
  messageID: "msg_lean",
  type: "tool",
  callID: "call_read",
  tool: "read",
  state: {
    status: "completed",
    input: { filePath: "shot.png" },
    output: "Image read successfully",
    title: "shot.png",
    metadata: {},
    time: { start: 1, end: 2 },
    attachments: [
      { id: "prt_file", sessionID: "ses_lean", messageID: "msg_lean", type: "file", mime: "image/png", url },
    ],
  },
}

async function receive(headers: Record<string, string>) {
  const controller = new AbortController()
  const response = await Server.Default().app.request("/global/event", { headers, signal: controller.signal })
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  const payloads: any[] = []
  let buffer = ""
  const read = async () => {
    while (!payloads.some((payload) => payload.type === "test.done")) {
      const chunk = await reader.read()
      if (chunk.done) break
      buffer += decoder.decode(chunk.value, { stream: true })
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""
      for (const line of lines) if (line.startsWith("data:")) payloads.push(JSON.parse(line.slice(5)).payload)
    }
  }
  // The stream subscribes to the bus only after it sends server.connected, so emit until it arrives.
  const emit = () => {
    GlobalBus.emit("event", { payload: { type: MessageV2.Event.PartUpdated.type, properties: { part } } })
    GlobalBus.emit("event", {
      payload: {
        type: "sync",
        syncEvent: {
          id: "evt_sync",
          type: `${MessageV2.Event.PartUpdated.type}.1`,
          seq: 1,
          aggregateID: "ses_lean",
          data: { part },
        },
      },
    })
    GlobalBus.emit("event", { payload: { type: "test.done", properties: {} } })
  }
  const timer = setInterval(emit, 50)
  try {
    await read()
  } finally {
    clearInterval(timer)
    controller.abort()
    await reader.cancel().catch(() => {})
  }
  return payloads
}

describe("global event stream", () => {
  test("keeps tool media and sync events for clients that do not opt out", async () => {
    const payloads = await receive({})
    expect(
      payloads.find((p) => p.type === MessageV2.Event.PartUpdated.type)?.properties.part.state.attachments[0].url,
    ).toBe(url)
    expect(payloads.find((p) => p.type === "sync")?.syncEvent.data.part.state.attachments[0].url).toBe(url)
  })

  test("drops tool media from part events and their sync copies", async () => {
    const payloads = await receive({ [MessageV2.OMIT_TOOL_MEDIA_HEADER]: "1" })
    expect(
      payloads.find((p) => p.type === MessageV2.Event.PartUpdated.type)?.properties.part.state.attachments[0],
    ).toMatchObject({
      mime: "image/png",
      url: "",
    })
    expect(payloads.find((p) => p.type === "sync")?.syncEvent.data.part.state.attachments[0].url).toBe("")
    expect(part.state.attachments[0].url).toBe(url)
  })

  test("leaves out sync events for clients that ignore them", async () => {
    const payloads = await receive({ [OMIT_SYNC_EVENTS_HEADER]: "1" })
    expect(payloads.some((p) => p.type === "sync")).toBe(false)
    expect(payloads.some((p) => p.type === MessageV2.Event.PartUpdated.type)).toBe(true)
  })
})
