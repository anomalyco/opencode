import { expect } from "bun:test"
import os from "node:os"
import path from "node:path"
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

// The profile has no host filesystem to check, so a location whose directory is not on this host still
// records its project.
it.live("records the project of a location whose directory is not on the host", () =>
  Effect.gen(function* () {
    const handler = yield* ServerWorkerd.create({
      storage: makeDurableObjectStorage(),
      app: { version: "workerd-test" },
      config: { content: "{}" },
      models: { fetch: false },
    })
    const directory = path.join(os.tmpdir(), `opencode-workerd-${crypto.randomUUID()}`, "project")

    const location = yield* Effect.promise(() =>
      handler(new Request(`http://opencode.local/api/location?location[directory]=${encodeURIComponent(directory)}`)),
    )
    expect(location.status).toBe(200)
    const { project } = yield* Effect.promise(() => location.json())
    const updated = yield* Effect.promise(() =>
      handler(
        new Request(`http://opencode.local/api/project/${project.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Remote" }),
        }),
      ),
    )
    expect(updated.status).toBe(200)
  }),
)
