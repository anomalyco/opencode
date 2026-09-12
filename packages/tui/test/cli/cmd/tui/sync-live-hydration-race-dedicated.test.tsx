/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import type { GlobalEvent } from "@opencode-ai/sdk/v2"
import { tmpdir } from "../../../fixture/fixture"
import { json, mount, wait } from "./sync-fixture"

const sessionID = "ses_hydration_race"
const session = {
  id: sessionID,
  title: "race",
  time: { created: 0, updated: 0 },
  version: "1.15.13",
  directory: "/tmp/opencode/packages/tui",
}

function global(payload: GlobalEvent["payload"]): GlobalEvent {
  return { directory: "/tmp/other", project: "proj_test", payload }
}

const raceUser = {
  id: "msg_user",
  sessionID,
  role: "user" as const,
  agent: "build",
  model: { providerID: "test", modelID: "model" },
  time: { created: 0 },
}

function raceDiff(patch: string) {
  return [{ file: "turn.ts", additions: 1, deletions: 0, status: "modified" as const, patch }]
}

test("a buffered diff does not overwrite a newer dedicated diff", async () => {
  await using tmp = await tmpdir()
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
  }, tmp.path)

  try {
    const hydrate = sync.session.sync(sessionID)
    await wait(() => requested)
    emit(
      global({
        id: "evt_diff_a",
        type: "message.diff.updated",
        properties: { sessionID, messageID: raceUser.id, diffs: raceDiff("PATCH-A") },
      }),
    )
    emit(global({ id: "evt_message", type: "message.updated", properties: { sessionID, info: raceUser } }))
    emit(
      global({
        id: "evt_diff_c",
        type: "message.diff.updated",
        properties: { sessionID, messageID: raceUser.id, diffs: raceDiff("PATCH-C") },
      }),
    )
    await wait(() => {
      const message = sync.data.message[sessionID]?.[0]
      return message?.role === "user" && message.summary?.diffs[0]?.patch === "PATCH-C"
    })
    resolveMessages(json([{ info: raceUser, parts: [] }]))
    await hydrate

    const message = sync.data.message[sessionID]?.[0]
    expect(message?.role === "user" ? message.summary?.diffs[0]?.patch : undefined).toBe("PATCH-C")
  } finally {
    app.renderer.destroy()
  }
})
