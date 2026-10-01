/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import type { GlobalEvent } from "@opencode-ai/sdk/v2"
import { tmpdir } from "../../../fixture/fixture"
import { mount, wait } from "./sync-fixture"

const loaded = "ses_loaded"
const unloaded = "ses_unloaded"
const message = {
  id: "msg_live",
  sessionID: loaded,
  role: "user" as const,
  agent: "build",
  model: { providerID: "test", modelID: "model" },
  time: { created: 1 },
}

function global(payload: GlobalEvent["payload"]): GlobalEvent {
  return { directory: "/tmp/other", project: "proj_test", payload }
}

// Every client receives every session's events. A removal for a session this
// client never loaded used to throw, and the throw ended the event loop, so the
// client silently stopped applying all later events.
test("removals in a session this client never loaded do not stop later events", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const { app, emit, sync } = await mount(undefined, tmp.path)

  try {
    expect(() =>
      emit(
        global({
          id: "evt_message_removed",
          type: "message.removed",
          properties: { sessionID: unloaded, messageID: "msg_gone" },
        }),
      ),
    ).not.toThrow()
    expect(() =>
      emit(
        global({
          id: "evt_part_removed",
          type: "message.part.removed",
          properties: { sessionID: unloaded, messageID: "msg_gone", partID: "prt_gone" },
        }),
      ),
    ).not.toThrow()

    emit(global({ id: "evt_message_updated", type: "message.updated", properties: { sessionID: loaded, info: message } }))
    await wait(() => sync.data.message[loaded]?.length === 1)
    expect(sync.data.message[loaded][0].id).toBe("msg_live")
  } finally {
    app.renderer.destroy()
  }
})
