/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { Global } from "@opencode-ai/core/global"
import type { GlobalEvent } from "@opencode-ai/sdk/v2"
import { tmpdir } from "../../../fixture/fixture"
import { json, mount, wait } from "./sync-fixture"

const sessionID = "ses_hydration_race"
const messageID = "msg_hydration_race"
const partID = "prt_hydration_race"
const session = {
  id: sessionID,
  title: "race",
  time: { created: 0, updated: 0 },
  version: "1.15.13",
  directory: "/tmp/opencode/packages/opencode",
}
const assistant = {
  id: messageID,
  sessionID,
  role: "assistant" as const,
  agent: "build",
  modelID: "model",
  providerID: "test",
  mode: "build",
  parentID: "msg_user",
  path: { cwd: session.directory, root: session.directory },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1, completed: 2 },
}

function global(payload: GlobalEvent["payload"]): GlobalEvent {
  return { directory: "/tmp/other", project: "proj_test", payload }
}

test("stale session hydration does not overwrite live message parts", async () => {
  const previous = Global.Path.state
  await using tmp = await tmpdir()
  Global.Path.state = tmp.path
  await Bun.write(`${tmp.path}/kv.json`, "{}")

  let resolveMessages!: (response: Response) => void
  const messages = new Promise<Response>((resolve) => {
    resolveMessages = resolve
  })
  let requested = false
  const { app, emit, sync } = await mount((url) => {
    if (url.pathname === `/session/${sessionID}`) return json(session)
    if (url.pathname === `/session/${sessionID}/message`) {
      requested = true
      return messages
    }
    if (url.pathname === `/session/${sessionID}/todo` || url.pathname === `/session/${sessionID}/diff`) return json([])
    return undefined
  })

  try {
    const hydrate = sync.session.sync(sessionID)
    await wait(() => requested)
    emit(global({ id: "evt_message", type: "message.updated", properties: { sessionID, info: assistant } }))
    emit(
      global({
        id: "evt_part",
        type: "message.part.updated",
        properties: {
          sessionID,
          time: 2,
          part: { id: partID, sessionID, messageID, type: "text", text: "visible live content" },
        },
      }),
    )
    await wait(() => sync.data.part[messageID]?.[0]?.type === "text")

    resolveMessages(
      json([
        {
          info: assistant,
          parts: [{ id: partID, sessionID, messageID, type: "text", text: "" }],
        },
      ]),
    )
    await hydrate

    expect(sync.data.part[messageID][0]).toMatchObject({ text: "visible live content" })
  } finally {
    app.renderer.destroy()
    Global.Path.state = previous
  }
})
