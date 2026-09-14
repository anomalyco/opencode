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

test("a removed message does not regain its buffered diff during hydration", async () => {
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
    emit(global({ id: "evt_removed", type: "message.removed", properties: { sessionID, messageID: raceUser.id } }))
    emit(global({ id: "evt_todo_tick", type: "todo.updated", properties: { sessionID, todos: [] } }))
    await wait(() => sync.data.todo[sessionID] !== undefined)
    resolveMessages(json([{ info: raceUser, parts: [] }]))
    await hydrate

    expect(sync.data.message[sessionID]?.find((item) => item.id === raceUser.id)).toBeUndefined()
  } finally {
    app.renderer.destroy()
  }
})
