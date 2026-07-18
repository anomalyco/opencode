import { describe, expect } from "bun:test"
import type { SessionNotification } from "@agentclientprotocol/sdk"
import { Effect } from "effect"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { cliIt } from "../../lib/cli-process"
import { createAcpClient, initialize, newSession, verifierConfig, verifierSkill } from "./helpers"

describe("opencode acp skills subprocess", () => {
  cliIt.live(
    "skill slash command appears through available_commands_update",
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        const skills = path.join(home, "skills")
        yield* Effect.promise(() => mkdir(path.join(skills, "verifier-skill"), { recursive: true }))
        yield* Effect.promise(() => Bun.write(path.join(skills, "verifier-skill", "SKILL.md"), verifierSkill))
        const acp = yield* createAcpClient(
          { opencode },
          { OPENCODE_CONFIG_CONTENT: JSON.stringify(verifierConfig(llm.url, skills)) },
        )
        yield* initialize(acp)
        const session = yield* newSession(acp, home)

        const update = yield* acp.waitForNotification<SessionNotification>(
          "session/update",
          (params) =>
            params.sessionId === session.sessionId &&
            params.update.sessionUpdate === "available_commands_update" &&
            params.update.availableCommands.some(
              (command) => command.name === "verifier-skill" && command.description.length > 0,
            ),
        )

        expect(update.params?.sessionId).toBe(session.sessionId)
      }),
    60_000,
  )
})
