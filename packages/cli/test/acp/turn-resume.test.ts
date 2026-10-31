import { describe, expect, test } from "bun:test"
import {
  childCreated,
  delivered,
  durableEvent,
  permissionAsked,
  startSession,
  stepEnded,
  succeeded,
  textDelta,
  turn,
} from "./wire-fixture"

const started = (sessionID: string) => durableEvent("session.execution.started", { sessionID })

function turnUpdates(updates: readonly { sessionId: string; update: unknown }[]) {
  return updates.filter(
    (item) =>
      (item.update as { sessionUpdate?: string }).sessionUpdate !== "available_commands_update" &&
      (item.update as { sessionUpdate?: string }).sessionUpdate !== "usage_update",
  )
}

describe("acp resumed parent turns over the wire", () => {
  test("streams a resumed parent turn after its background child settles", async () => {
    await using acp = await startSession({
      capabilities: { childSessionUpdates: true },
      onPrompt: ({ sessionID, id }) =>
        turn(
          sessionID,
          id,
          childCreated("ses_child", sessionID, "Research"),
          started("ses_child"),
        ),
    })

    expect((await acp.prompt(acp.sessionId, "spawn")).stopReason).toBe("end_turn")
    const responded = turnUpdates(acp.updates).length

    acp.server.send(
      succeeded("ses_child"),
      delivered(acp.sessionId, "msg_resume"),
      textDelta(acp.sessionId, "msg_resume", "resumed"),
      stepEnded(acp.sessionId, "msg_resume"),
      succeeded(acp.sessionId),
    )

    await acp.waitForUpdate(
      (update) => JSON.stringify(update).includes("resumed"),
      "resumed parent update",
    )
    expect(turnUpdates(acp.updates).slice(responded)).toEqual([
      {
        sessionId: acp.sessionId,
        update: { sessionUpdate: "agent_message_chunk", messageId: "msg_resume", content: { type: "text", text: "resumed" } },
      },
    ])
  })

  test("delivers a resume that starts while another child still runs", async () => {
    await using acp = await startSession({
      capabilities: { childSessionUpdates: true },
      onPrompt: ({ sessionID, id }) =>
        turn(
          sessionID,
          id,
          childCreated("ses_child", sessionID, "Research"),
          started("ses_child"),
          childCreated("ses_other", sessionID, "Other"),
          started("ses_other"),
        ),
    })

    expect((await acp.prompt(acp.sessionId, "spawn two")).stopReason).toBe("end_turn")
    const responded = turnUpdates(acp.updates).length

    acp.server.send(
      succeeded("ses_child"),
      delivered(acp.sessionId, "msg_resume"),
      textDelta(acp.sessionId, "msg_resume", "early"),
      succeeded(acp.sessionId),
      succeeded("ses_other"),
      delivered(acp.sessionId, "msg_resume2"),
      textDelta(acp.sessionId, "msg_resume2", "late"),
      succeeded(acp.sessionId),
    )

    await acp.waitForUpdate(
      (update) => JSON.stringify(update).includes("late"),
      "second resume update",
    )
    expect(turnUpdates(acp.updates).slice(responded)).toEqual([
      {
        sessionId: acp.sessionId,
        update: { sessionUpdate: "agent_message_chunk", messageId: "msg_resume", content: { type: "text", text: "early" } },
      },
      {
        sessionId: acp.sessionId,
        update: { sessionUpdate: "agent_message_chunk", messageId: "msg_resume2", content: { type: "text", text: "late" } },
      },
    ])
  })

  test("hands the subscription to the next prompt without duplicate updates", async () => {
    await using acp = await startSession({
      capabilities: { childSessionUpdates: true },
      onPrompt: ({ sessionID, id }) =>
        acp.server.prompts.length > 1
          ? turn(sessionID, id, textDelta(sessionID, "msg_second", "second"))
          : turn(
              sessionID,
              id,
              childCreated("ses_child", sessionID, "Research"),
              started("ses_child"),
            ),
    })

    expect((await acp.prompt(acp.sessionId, "spawn")).stopReason).toBe("end_turn")
    const responded = turnUpdates(acp.updates).length

    acp.server.send(
      succeeded("ses_child"),
      delivered(acp.sessionId, "msg_resume"),
      textDelta(acp.sessionId, "msg_resume", "first-part"),
    )

    expect((await acp.prompt(acp.sessionId, "again")).stopReason).toBe("end_turn")

    const updates = turnUpdates(acp.updates).slice(responded)
    const firstPart = updates.find((u) => JSON.stringify(u).includes("first-part"))
    const second = updates.find((u) => JSON.stringify(u).includes("second"))
    expect(firstPart).toBeDefined()
    expect(second).toBeDefined()
    expect(updates.indexOf(firstPart!)).toBeLessThan(updates.indexOf(second!))
    expect(updates.filter((u) => JSON.stringify(u).includes("first-part")).length).toBe(1)
    expect(updates.filter((u) => JSON.stringify(u).includes("second")).length).toBe(1)
  })

  test("keeps tracking children that stay open across a new prompt", async () => {
    await using acp = await startSession({
      capabilities: { childSessionUpdates: true },
      onPrompt: ({ sessionID, id }) =>
        acp.server.prompts.length > 1
          ? turn(sessionID, id)
          : turn(
              sessionID,
              id,
              childCreated("ses_child", sessionID, "Research"),
              started("ses_child"),
            ),
      permission: () => ({ outcome: { outcome: "selected", optionId: "once" } }),
    })

    expect((await acp.prompt(acp.sessionId, "spawn")).stopReason).toBe("end_turn")
    expect((await acp.prompt(acp.sessionId, "again")).stopReason).toBe("end_turn")

    acp.server.send(
      permissionAsked("ses_child", "perm_late", { action: "read", resources: ["*"] }),
      textDelta("ses_child", "msg_child", "child-late"),
      succeeded("ses_child"),
    )

    await acp.until(() => acp.server.replies.length === 1, "child permission reply")
    expect(acp.childUpdates).toMatchObject([
      { childSessionId: "ses_child", depth: 1, type: "status", status: "created" },
      { childSessionId: "ses_child", type: "status", status: "running" },
      { childSessionId: "ses_child", type: "update", update: { sessionUpdate: "agent_message_chunk" } },
      { childSessionId: "ses_child", type: "status", status: "completed" },
    ])
    expect(acp.server.replies).toEqual([
      { sessionID: "ses_child", requestID: "perm_late", decision: "once" },
    ])

    acp.server.send(
      delivered(acp.sessionId, "msg_resume"),
      textDelta(acp.sessionId, "msg_resume", "resumed-late"),
      succeeded(acp.sessionId),
    )

    await acp.waitForUpdate(
      (update) => JSON.stringify(update).includes("resumed-late"),
      "resumed parent update after child",
    )
    expect(turnUpdates(acp.updates).some((u) => JSON.stringify(u).includes("resumed-late"))).toBe(true)
  })
})