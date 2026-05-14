// Regression: a stored step-finish part with a negative token count made the
// messages endpoint 400. Some providers reported `outputTokens` excluding
// reasoning while also reporting `reasoningTokens` separately, so the
// `outputTokens - reasoningTokens` math in Session.getUsage underflowed to
// negative. The pre-fix `safe()` clamp only guarded against non-finite. The
// strict `NonNegativeInt` schema then made every load of the message list
// fail to encode, killing Desktop boot for every user with such a row.
import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { eq } from "drizzle-orm"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Server } from "../../src/server/server"
import { SessionPaths } from "../../src/server/routes/instance/httpapi/groups/session"
import { Session } from "@/session/session"
import { MessageID, PartID } from "../../src/session/schema"
import * as Database from "@/storage/db"
import { PartTable } from "@/session/session.sql"
import { resetDatabase } from "../fixture/db"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(Session.defaultLayer)

function seedNegativeTokenSession() {
  return Effect.gen(function* () {
    const session = yield* Session.Service
    const info = yield* session.create({})
    const message = yield* session.updateMessage({
      id: MessageID.ascending(),
      role: "user",
      sessionID: info.id,
      agent: "build",
      model: { providerID: ProviderID.make("test"), modelID: ModelID.make("test") },
      time: { created: Date.now() },
    })
    const partID = PartID.ascending()
    yield* session.updatePart({
      id: partID,
      sessionID: info.id,
      messageID: message.id,
      type: "step-finish",
      reason: "stop",
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    })

    // Bypass the schema with a direct SQL update to install the
    // negative `output` value we want to test loading.
    Database.use((db) =>
      db
        .update(PartTable)
        .set({
          data: {
            type: "step-finish",
            reason: "stop",
            cost: 0,
            tokens: { input: 0, output: -42, reasoning: 0, cache: { read: 0, write: 0 } },
          } as never,
        })
        .where(eq(PartTable.id, partID))
        .run(),
    )

    return info.id
  })
}

describe("messages endpoint tolerates legacy negative token counts", () => {
  it.instance(
    "returns 200 even when a step-finish part has tokens.output < 0",
    Effect.gen(function* () {
      yield* Effect.addFinalizer(() => Effect.promise(() => resetDatabase()))
      const test = yield* TestInstance
      const sessionID = yield* seedNegativeTokenSession()
      const url = `${SessionPaths.messages.replace(":sessionID", sessionID)}?limit=80&directory=${encodeURIComponent(test.directory)}`
      const res = yield* Effect.promise(async () => Server.Default().app.request(url))
      expect(res.status, "messages endpoint 400'd on legacy negative tokens").not.toBe(400)
    }),
    { git: true, config: { formatter: false, lsp: false } },
  )
})
