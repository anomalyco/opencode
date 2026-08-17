import type { SessionNotification } from "@agentclientprotocol/sdk"
import { describe, expect, test } from "bun:test"
import { createAcpFixture, initialize, newSession, verifierSkill } from "./subprocess"

describe("acp skills subprocess", () => {
  test("skill slash command appears through available_commands_update", async () => {
    await using fixture = await createAcpFixture({ skill: verifierSkill })
    const acp = fixture.spawn()
    await initialize(acp)
    const session = await newSession(acp, fixture.home)

    const update = await acp.waitForNotification<SessionNotification>(
      "session/update",
      (params) =>
        params.sessionId === session.sessionId &&
        params.update.sessionUpdate === "available_commands_update" &&
        params.update.availableCommands.some(
          (command) => command.name === "verifier-skill" && command.description.length > 0,
        ),
    )

    expect(update.params.sessionId).toBe(session.sessionId)
  }, 60_000)
})
