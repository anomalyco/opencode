import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Effect, Schema } from "effect"

test("embedded client uses the real router and handlers", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opencode-embedded-"))
  const database = Flag.OPENCODE_DB
  Flag.OPENCODE_DB = join(directory, "opencode.sqlite")
  const { AbsolutePath, Agent, Location, Model, OpenCode, Prompt, Provider, Session, Tool } = await import("../src")
  const sessionID = Session.ID.make(`ses_embedded_${crypto.randomUUID()}`)
  const model = Model.Ref.make({ id: Model.ID.make("embedded"), providerID: Provider.ID.make("test") })

  try {
    const program = Effect.gen(function* () {
      const opencode = yield* OpenCode.create()
      yield* opencode.tools.register({
        embedded_tool: Tool.make({
          description: "Embedded test tool",
          input: Schema.Struct({}),
          output: Schema.Struct({ ok: Schema.Boolean }),
          execute: () => Effect.succeed({ ok: true }),
        }),
      })

      const created = yield* opencode.sessions.create({
        id: sessionID,
        agent: Agent.ID.make("build"),
        location: Location.Ref.make({ directory: AbsolutePath.make(directory) }),
      })
      yield* opencode.sessions.switchModel({ sessionID, model })
      const selected = yield* opencode.sessions.get({ sessionID })
      const page = yield* opencode.sessions.list({ directory: AbsolutePath.make(directory) })
      const admitted = yield* opencode.sessions.prompt({
        sessionID,
        prompt: Prompt.make({ text: "Do not run" }),
        resume: false,
      })
      const context = yield* opencode.sessions.context({ sessionID })
      const missing = yield* Effect.flip(
        opencode.sessions.get({ sessionID: Session.ID.make(`ses_missing_${crypto.randomUUID()}`) }),
      )

      expect(created.id).toBe(sessionID)
      expect(selected.model?.id).toBe(model.id)
      expect(selected.model?.providerID).toBe(model.providerID)
      expect(page.data.some((session) => session.id === sessionID)).toBe(true)
      expect(admitted.sessionID).toBe(sessionID)
      expect(context.some((message) => message.type === "model-switched")).toBe(true)
      expect(missing._tag).toBe("SessionNotFoundError")
    })
    await Effect.runPromise(Effect.scoped(program))
  } finally {
    Flag.OPENCODE_DB = database
    await rm(directory, { recursive: true, force: true })
  }
})

test("embedded client is available as a Layer service", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opencode-embedded-layer-"))
  const database = Flag.OPENCODE_DB
  Flag.OPENCODE_DB = join(directory, "opencode.sqlite")
  const { AbsolutePath, Location, OpenCode, Session } = await import("../src")
  const sessionID = Session.ID.make(`ses_embedded_${crypto.randomUUID()}`)

  try {
    const created = await Effect.runPromise(
      Effect.gen(function* () {
        const opencode = yield* OpenCode.Service
        return yield* opencode.sessions.create({
          id: sessionID,
          location: Location.Ref.make({ directory: AbsolutePath.make(directory) }),
        })
      }).pipe(Effect.provide(OpenCode.layer), Effect.scoped),
    )

    expect(created.id).toBe(sessionID)
  } finally {
    Flag.OPENCODE_DB = database
    await rm(directory, { recursive: true, force: true })
  }
})
