import { expect } from "bun:test"
import { Effect } from "effect"
import { makeDurableObjectStorage } from "../../core/test/fixture/durable-object-storage"
import { it } from "../../core/test/lib/effect"
import { ServerWorkerd } from "../src/workerd"

// Covers the profile's replacement graph composing and the database booting
// through the injected Durable Object storage.
it.live("boots the workerd profile over durable object storage", () =>
  Effect.gen(function* () {
    const handler = yield* ServerWorkerd.create({
      storage: makeDurableObjectStorage(),
      password: "secret",
      app: { version: "workerd-test" },
      config: { content: "{}" },
    })

    const unauthorized = yield* Effect.promise(() => handler(new Request("http://opencode.local/api/info")))
    expect(unauthorized.status).toBe(401)

    const status = yield* Effect.promise(() =>
      handler(
        new Request("http://opencode.local/api/info", {
          headers: { authorization: `Basic ${btoa("opencode:secret")}` },
        }),
      ),
    )
    expect(status.status).toBe(200)

    const body: unknown = yield* Effect.promise(() => status.json())
    expect(body).toMatchObject({ version: "workerd-test" })
  }),
)

it.live("keeps opencode's tables under the database prefix beside the object's own tables", () =>
  Effect.gen(function* () {
    const storage = makeDurableObjectStorage()
    storage.sql.exec("CREATE TABLE session (id TEXT PRIMARY KEY)")
    storage.sql.exec("INSERT INTO session (id) VALUES ('host')")
    const handler = yield* ServerWorkerd.create({
      storage,
      database: { prefix: "opencode_" },
      app: { version: "workerd-test" },
      config: { content: "{}" },
    })

    const status = yield* Effect.promise(() => handler(new Request("http://opencode.local/api/info")))
    expect(status.status).toBe(200)

    const names = storage.sql
      .exec("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_%' ESCAPE '\\'")
      .toArray()
      .map((row) => String(row.name))
    expect(names).toContain("opencode_session_v2")
    expect(names.filter((name) => !name.startsWith("opencode_"))).toEqual(["session"])
    expect(storage.sql.exec("SELECT id FROM session").toArray()).toEqual([{ id: "host" }])
  }),
)
