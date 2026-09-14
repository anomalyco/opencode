/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import type { GlobalEvent } from "@opencode-ai/sdk/v2"
import { tmpdir } from "../../../fixture/fixture"
import { json, mount, wait } from "./sync-fixture"

const sessionID = "ses_hydration_failure"
const messageID = "msg_hydration_failure"
const session = {
  id: sessionID,
  title: "failure",
  time: { created: 0, updated: 0 },
  version: "1.15.13",
  directory: "/tmp/opencode/packages/tui",
}
const user = {
  id: messageID,
  sessionID,
  role: "user" as const,
  agent: "build",
  model: { providerID: "test", modelID: "model" },
  time: { created: 0 },
}

function global(payload: GlobalEvent["payload"]): GlobalEvent {
  return { directory: "/tmp/other", project: "proj_test", payload }
}

function diffs(patch: string) {
  return [{ file: "turn.ts", additions: 1, deletions: 0, status: "modified" as const, patch }]
}

test("a failed hydration cannot replay its buffered diff over a fresh retry", async () => {
  await using tmp = await tmpdir()
  await Bun.write(`${tmp.path}/kv.json`, "{}")
  const failed = Promise.withResolvers<Response>()
  let requests = 0
  const { app, emit, sync } = await mount((url) => {
    if (url.pathname === `/session/${sessionID}`) {
      requests++
      return requests === 1 ? failed.promise : json(session)
    }
    if (url.pathname === `/session/${sessionID}/message`)
      return json([{ info: { ...user, summary: { diffs: diffs("PATCH-B") } }, parts: [] }])
    if (url.pathname === `/session/${sessionID}/todo` || url.pathname === `/session/${sessionID}/diff`) return json([])
    return undefined
  }, tmp.path)

  try {
    const loading = sync.session.sync(sessionID).catch((error) => error)
    await wait(() => requests === 1)
    emit(
      global({
        id: "evt_diff_a",
        type: "message.diff.updated",
        properties: { sessionID, messageID, diffs: diffs("PATCH-A") },
      }),
    )
    emit(global({ id: "evt_tick", type: "todo.updated", properties: { sessionID, todos: [] } }))
    await wait(() => sync.data.todo[sessionID] !== undefined)
    failed.reject(new Error("connection reset"))
    await loading
    await sync.session.sync(sessionID)

    const message = sync.data.message[sessionID]?.[0]
    expect(message?.role === "user" ? message.summary?.diffs[0]?.patch : undefined).toBe("PATCH-B")
  } finally {
    app.renderer.destroy()
  }
})
