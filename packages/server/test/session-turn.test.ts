import { expect } from "bun:test"
import { Effect, Schema } from "effect"
import { Session } from "@opencode/schema/session"
import { SessionMessage } from "@opencode/schema/session-message"
import { SessionTurn } from "@opencode/schema/session-turn"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"
import { tmpdir } from "../../core/test/fixture/tmpdir"

it.live("addresses an admitted prompt by its input ID and rejects unknown input or session IDs", () =>
  Effect.gen(function* () {
    const directory = yield* Effect.acquireDisposable(Effect.promise(() => tmpdir("opencode-turn-")))
    const handler = yield* ServerFetch.make({
      app: { version: "test" },
      database: { path: ":memory:" },
      fs: { filewatcher: false },
      models: { fetch: false },
      config: { directory: directory.path, project: false, claude: false },
    })
    const request = (path: string, body?: unknown) =>
      Effect.promise(() =>
        handler(
          new Request(`http://opencode.local/api/${path}`, {
            method: body ? "POST" : "GET",
            headers: { "content-type": "application/json" },
            body: body ? JSON.stringify(body) : undefined,
          }),
        ),
      )
    const created = yield* request("session", { title: "Turn" })
    const sessionID = Schema.decodeUnknownSync(Schema.Struct({ data: Session.Info }))(
      yield* Effect.promise(() => created.json()),
    ).data.id
    const inputID = SessionMessage.ID.create()
    expect((yield* request(`session/${sessionID}/prompt`, { id: inputID, text: "Work", resume: false })).status).toBe(
      200,
    )
    const response = yield* request(`experimental/session/${sessionID}/turn/${inputID}`)
    expect(response.status).toBe(200)
    expect(
      Schema.decodeUnknownSync(Schema.Struct({ data: SessionTurn.Info }))(yield* Effect.promise(() => response.json()))
        .data,
    ).toEqual({ sessionID, inputID, status: "pending" })
    expect((yield* request(`experimental/session/${sessionID}/turn/${SessionMessage.ID.create()}`)).status).toBe(404)
    expect((yield* request(`experimental/session/${Session.ID.create()}/turn/${inputID}`)).status).toBe(404)
  }).pipe(Effect.scoped),
)
