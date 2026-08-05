import { afterEach, describe, expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Effect, Layer } from "effect"
import { HttpClientResponse } from "effect/unstable/http"
import { eq } from "drizzle-orm"
import { Database } from "@opencode-ai/core/database/database"

import { Session } from "@/session/session"
import { SessionPaths } from "../../src/server/routes/instance/httpapi/groups/session"
import { MessageID, PartID } from "../../src/session/schema"
import { PartTable } from "@opencode-ai/core/session/sql"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { httpApiLayer, requestInDirectory } from "./httpapi-layer"

const it = testEffect(Layer.mergeAll(LayerNode.compile(LayerNode.group([Session.node, Database.node])), httpApiLayer))

const text = (response: HttpClientResponse.HttpClientResponse) => response.text

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

const seedCorruptStepFinishPart = Effect.gen(function* () {
  const session = yield* Session.Service
  const info = yield* session.create({})
  const message = yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID: info.id,
    agent: "build",
    model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test") },
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
  // Schema.Finite still rejects NaN at encode: exact mirror of the corrupt row
  // that broke the user's session in the OMO/Windows bug.
  const { db } = yield* Database.Service
  yield* db
    .update(PartTable)
    .set({
      data: {
        type: "step-finish",
        reason: "stop",
        cost: 0,
        tokens: { input: 0, output: NaN, reasoning: 0, cache: { read: 0, write: 0 } },
      } as never, // drizzle's .set() can't narrow the discriminated union
    })
    .where(eq(PartTable.id, partID))
    .run()
    .pipe(Effect.orDie)
  return info.id
})

describe("schema-rejection wire shape", () => {
  it.instance(
    "Query schema rejection returns NamedError-shaped JSON",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        // /find/file?limit=999999 violates the limit constraint check.
        const url = `/find/file?query=foo&limit=999999&directory=${encodeURIComponent(test.directory)}`
        const res = yield* requestInDirectory(url, test.directory)
        const body = yield* text(res)
        expect(res.status).toBe(400)
        const parsed = JSON.parse(body)
        expect(parsed).toMatchObject({ name: "BadRequest", data: { kind: "Query" } })
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "v2 query schema rejection returns InvalidRequestError JSON",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const res = yield* requestInDirectory("/api/session?limit=0", test.directory)
        const parsed = JSON.parse(yield* text(res))
        expect(res.status).toBe(400)
        expect(parsed).toMatchObject({ _tag: "InvalidRequestError", kind: "Query" })
        expect(parsed.message).toEqual(expect.any(String))
      }),
    { git: true, config: { formatter: false, lsp: false } },
  )

  it.instance(
    "response-encode failure: corrupted stored row returns NamedError-shaped JSON with field path",
    () =>
      Effect.gen(function* () {
        const test = yield* TestInstance
        const sessionID = yield* seedCorruptStepFinishPart
        const url = `${SessionPaths.messages.replace(":sessionID", sessionID)}?limit=80&directory=${encodeURIComponent(test.directory)}`
        const res = yield* requestInDirectory(url, test.directory)
        const body = yield* text(res)
        expect(res.status).toBe(400)
        expect(res.headers["content-type"] ?? "").toContain("application/json")
        const parsed = JSON.parse(body)
        expect(parsed).toMatchObject({ name: "BadRequest", data: { kind: "Body" } })
        // Field path in data.message — what made this PR worth shipping.
        expect(parsed.data.message).toMatch(/output/)
      }),
    { config: { formatter: false, lsp: false } },
  )
})
