import { afterEach, describe, expect } from "bun:test"
import { Exit, Effect } from "effect"
import { Artifact } from "@opencode-ai/core/artifact"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionExecutionLocal } from "@opencode-ai/core/session/execution/local"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { Agent } from "../../src/agent/agent"
import { Session } from "@/session/session"
import { MessageID, SessionID } from "../../src/session/schema"
import { Truncate } from "@/tool/truncate"
import { ArtifactTool } from "../../src/tool/artifact"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

afterEach(async () => {
  await disposeAllInstances()
})

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Session.node, SessionProjector.node, Artifact.node, Agent.node, Truncate.node]),
    [[SessionExecution.node, SessionExecutionLocal.node]],
  ),
)

const seed = Effect.fn("ArtifactToolTest.seed")(function* () {
  const sessions = yield* Session.Service
  return yield* sessions.create({ title: "artifact tool" })
})

const ctx = (sessionID: SessionID) => ({
  sessionID,
  messageID: MessageID.ascending(),
  agent: "build",
  abort: new AbortController().signal,
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
})

describe("tool.artifact", () => {
  it.instance("creates, reads, lists, and updates artifacts", () =>
    Effect.gen(function* () {
      const chat = yield* seed()
      const tool = yield* ArtifactTool
      const def = yield* tool.init()

      const created = yield* def.execute(
        {
          action: "create",
          name: "browser evidence",
          type: "TEST_RESULT",
          content: "5 of 5 flows passed",
          agent: "browser",
          task: "T-1",
        },
        ctx(chat.id),
      )
      expect(created.title).toBe("artifact created")
      expect(created.output).toContain("version 1")
      expect(created.output).toContain("(status draft)")
      expect(created.output).toContain(`linked to session ${chat.id}`)
      const matched = created.output.match(/art_\w+/)?.[0]
      expect(matched).toBeDefined()
      if (matched === undefined) throw new Error("expected an artifact id in the tool output")
      const id = Artifact.ID.make(matched)

      const fetched = yield* def.execute({ action: "get", id }, ctx(chat.id))
      expect(fetched.title).toBe("artifact get")
      expect(fetched.output).toContain(`"id": "${id}"`)
      expect(fetched.output).toContain(`"sessionID": "${chat.id}"`)
      expect(fetched.output).toContain(`"version": 1`)
      expect(fetched.output).toContain(`"status": "draft"`)

      const listed = yield* def.execute({ action: "list", task: "T-1" }, ctx(chat.id))
      expect(listed.output).toContain("1 artifact(s)")
      expect(listed.output).toContain(id)
      expect(listed.output).toContain("[TEST_RESULT]")
      expect(listed.output).toContain("comments=0")

      const filtered = yield* def.execute({ action: "list", task: "T-1", type: "PLAN" }, ctx(chat.id))
      expect(filtered.output).toBe("No artifacts found.")

      const updated = yield* def.execute({ action: "update", id, status: "ready" }, ctx(chat.id))
      expect(updated.title).toBe("artifact updated")
      expect(updated.output).toContain("now version 2 (status ready)")
    }),
  )

  it.instance("fails when the action is missing a required field", () =>
    Effect.gen(function* () {
      const chat = yield* seed()
      const tool = yield* ArtifactTool
      const def = yield* tool.init()

      const createExit = yield* def
        .execute({ action: "create", type: "PLAN", content: "a plan" }, ctx(chat.id))
        .pipe(Effect.exit)
      expect(Exit.isFailure(createExit)).toBe(true)

      const getExit = yield* def.execute({ action: "get" }, ctx(chat.id)).pipe(Effect.exit)
      expect(Exit.isFailure(getExit)).toBe(true)

      const updateExit = yield* def.execute({ action: "update", status: "ready" }, ctx(chat.id)).pipe(Effect.exit)
      expect(Exit.isFailure(updateExit)).toBe(true)
    }),
  )

  it.instance("fails on unknown artifact ids instead of reporting success", () =>
    Effect.gen(function* () {
      const chat = yield* seed()
      const tool = yield* ArtifactTool
      const def = yield* tool.init()

      const getExit = yield* def
        .execute({ action: "get", id: Artifact.ID.make("art_missing") }, ctx(chat.id))
        .pipe(Effect.exit)
      expect(Exit.isFailure(getExit)).toBe(true)

      const updateExit = yield* def
        .execute({ action: "update", id: Artifact.ID.make("art_missing"), status: "ready" }, ctx(chat.id))
        .pipe(Effect.exit)
      expect(Exit.isFailure(updateExit)).toBe(true)
    }),
  )
})
