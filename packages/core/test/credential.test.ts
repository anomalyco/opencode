import { describe, expect } from "bun:test"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { Bus } from "@opencode-ai/core/bus"
import { Credential } from "@opencode-ai/core/credential"
import { CredentialTable } from "@opencode-ai/core/credential/sql"
import { Database } from "@opencode-ai/core/database/database"
import { Location } from "@opencode-ai/core/location"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Workspace } from "@opencode-ai/core/workspace"
import { Event } from "@opencode-ai/schema/event"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Integration } from "@opencode-ai/core/integration"
import { location } from "./fixture/location"
import { testEffect } from "./lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([Credential.node, Bus.node, Database.node])))

describe("Credential", () => {
  it.effect("stores, updates, lists, and removes credentials", () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      const integrationID = Integration.ID.make("openai")
      const created = yield* credentials.create({
        integrationID,
        label: "Work",
        value: Credential.Key.make({ type: "key", key: "secret" }),
      })

      expect(yield* credentials.list(integrationID)).toEqual([created])
      yield* credentials.update(created.id, { label: "Personal" })
      expect((yield* credentials.list(integrationID))[0]?.label).toBe("Personal")

      const additional = yield* credentials.create({
        integrationID,
        label: "Additional",
        value: Credential.Key.make({ type: "key", key: "additional" }),
      })
      expect(yield* credentials.list(integrationID)).toEqual([
        expect.objectContaining({ id: created.id, label: "Personal" }),
        additional,
      ])

      yield* credentials.remove(additional.id)
      expect(yield* credentials.list(integrationID)).toEqual([
        expect.objectContaining({ id: created.id, label: "Personal" }),
      ])
    }),
  )

  it.effect("publishes global events only for observable credential mutations", () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      const bus = yield* Bus.Service
      const integrationID = Integration.ID.make("openai")
      const events = new Array<Event.Payload>()
      yield* bus.listen((event) => Effect.sync(() => events.push(event)))

      const older = yield* credentials
        .create({ integrationID, value: Credential.Key.make({ type: "key", key: "older" }) })
        .pipe(
          Effect.provideService(
            Location.Service,
            Location.Service.of(
              location({ directory: AbsolutePath.make("project"), workspaceID: Workspace.ID.make("wrk_test") }),
            ),
          ),
        )
      const newer = yield* credentials.create({
        integrationID,
        value: Credential.Key.make({ type: "key", key: "newer" }),
      })

      yield* credentials.activate(newer.id)
      yield* credentials.activate(Credential.ID.create())
      yield* credentials.activate(older.id)
      yield* credentials.activate(older.id)
      yield* credentials.update(older.id, {})
      yield* credentials.update(Credential.ID.create(), { label: "Missing" })
      yield* credentials.update(older.id, { label: "default" })
      yield* credentials.update(older.id, { value: Credential.Key.make({ type: "key", key: "refreshed" }) })
      yield* credentials.update(older.id, { label: "Renamed" })
      yield* credentials.remove(Credential.ID.create())
      yield* credentials.remove(newer.id)
      yield* credentials.remove(newer.id)
      expect((yield* credentials.list(integrationID)).at(-1)?.id).toBe(older.id)

      const replacement = yield* credentials.create({
        integrationID,
        value: Credential.Key.make({ type: "key", key: "replacement" }),
      })
      yield* credentials.remove(replacement.id)
      expect((yield* credentials.list(integrationID)).at(-1)?.id).toBe(older.id)
      yield* credentials.remove(older.id)
      expect(yield* credentials.list(integrationID)).toEqual([])

      expect(events.map((event) => ({ type: event.type, data: event.data }))).toEqual([
        { type: Credential.Event.Updated.type, data: {} },
        { type: Credential.Event.Switched.type, data: { integrationID, credentialID: older.id } },
        { type: Credential.Event.Updated.type, data: {} },
        { type: Credential.Event.Switched.type, data: { integrationID, credentialID: newer.id } },
        { type: Credential.Event.Switched.type, data: { integrationID, credentialID: older.id } },
        { type: Credential.Event.Updated.type, data: {} },
        { type: Credential.Event.Updated.type, data: {} },
        { type: Credential.Event.Updated.type, data: {} },
        { type: Credential.Event.Switched.type, data: { integrationID, credentialID: replacement.id } },
        { type: Credential.Event.Updated.type, data: {} },
        { type: Credential.Event.Switched.type, data: { integrationID, credentialID: older.id } },
        { type: Credential.Event.Updated.type, data: {} },
        { type: Credential.Event.Switched.type, data: { integrationID, credentialID: null } },
      ])
      expect(events.every((event) => !("location" in event))).toBeTrue()
    }),
  )

  it.effect("promotes the newest remaining legacy credential when the effective selection is removed", () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      const bus = yield* Bus.Service
      const database = yield* Database.Service
      const integrationID = Integration.ID.make("openai")
      const oldest = yield* credentials.create({
        integrationID,
        value: Credential.Key.make({ type: "key", key: "oldest" }),
      })
      const newer = yield* credentials.create({
        integrationID,
        value: Credential.Key.make({ type: "key", key: "newer" }),
      })
      const newest = yield* credentials.create({
        integrationID,
        value: Credential.Key.make({ type: "key", key: "newest" }),
      })
      yield* database.db
        .update(CredentialTable)
        .set({ active: null })
        .where(eq(CredentialTable.integration_id, integrationID))
        .run()
        .pipe(Effect.orDie)

      const events = new Array<Event.Payload>()
      yield* bus.listen((event) => Effect.sync(() => events.push(event)))
      yield* credentials.activate(newest.id)
      yield* credentials.remove(oldest.id)
      yield* credentials.remove(newest.id)

      expect(yield* credentials.list(integrationID)).toEqual([newer])
      expect(
        yield* database.db
          .select({ active: CredentialTable.active })
          .from(CredentialTable)
          .where(eq(CredentialTable.id, newer.id))
          .get()
          .pipe(Effect.orDie),
      ).toEqual({ active: true })
      expect(events.map((event) => ({ type: event.type, data: event.data }))).toEqual([
        { type: Credential.Event.Updated.type, data: {} },
        { type: Credential.Event.Updated.type, data: {} },
        { type: Credential.Event.Switched.type, data: { integrationID, credentialID: newer.id } },
      ])
    }),
  )

  it.effect("activates older credentials without affecting other integrations", () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      const integrationID = Integration.ID.make("openai")
      const otherIntegrationID = Integration.ID.make("anthropic")
      const older = yield* credentials.create({
        integrationID,
        value: Credential.Key.make({ type: "key", key: "older" }),
      })
      const newer = yield* credentials.create({
        integrationID,
        value: Credential.Key.make({ type: "key", key: "newer" }),
      })
      const otherOlder = yield* credentials.create({
        integrationID: otherIntegrationID,
        value: Credential.Key.make({ type: "key", key: "other-older" }),
      })
      const otherNewer = yield* credentials.create({
        integrationID: otherIntegrationID,
        value: Credential.Key.make({ type: "key", key: "other-newer" }),
      })

      yield* credentials.activate(older.id)
      expect(yield* credentials.list(integrationID)).toEqual([newer, older])
      expect(yield* credentials.list(otherIntegrationID)).toEqual([otherOlder, otherNewer])

      yield* credentials.activate(Credential.ID.create())
      expect((yield* credentials.list(integrationID)).at(-1)).toEqual(older)

      yield* credentials.activate(otherOlder.id)
      expect(yield* credentials.list(otherIntegrationID)).toEqual([otherNewer, otherOlder])
      expect((yield* credentials.list(integrationID)).at(-1)).toEqual(older)

      yield* credentials.remove(older.id)
      expect((yield* credentials.list(integrationID)).at(-1)).toEqual(newer)
      expect((yield* credentials.list(otherIntegrationID)).at(-1)).toEqual(otherOlder)
    }),
  )
})
