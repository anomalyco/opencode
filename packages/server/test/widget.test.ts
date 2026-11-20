import path from "node:path"
import { expect } from "bun:test"
import { OpenCode, type SessionMessageInfo } from "@opencode/client"
import { Session } from "@opencode/schema/session"
import { builtins, program } from "@opencode/widget"
import { Effect } from "effect"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const confirm = builtins.find((template) => template.name === "confirm")!

const widget: SessionMessageInfo = {
  id: "msg_widget_open",
  type: "widget",
  title: "Deploy",
  template: { name: "confirm", version: confirm.version },
  data: { title: "Ship it?", message: "Deploys main." },
  status: "open",
  time: { created: 100 },
}

const serve = (database: string) =>
  ServerFetch.make({
    app: { version: "test" },
    database: { path: database },
    config: { directory: path.dirname(database), project: false, content: "{}" },
    models: { fetch: false },
    fs: { filewatcher: false },
  })

const client = (handler: (request: Request) => Promise<Response>) =>
  OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: Object.assign((input: string | URL | Request, init?: RequestInit) => handler(new Request(input, init)), {
      preconnect: fetch.preconnect,
    }),
  })

it.live("serves widget templates and records one response per widget", () =>
  Effect.gen(function* () {
    // Acquired first so it is removed after the server below is released; Windows can't delete an open db.
    const dir = (yield* tmpdirScoped("opencode-widget-api-")).path
    yield* Effect.gen(function* () {
      const handler = yield* serve(path.join(dir, "opencode.db"))
      const api = client(handler)
      const sessionID = Session.ID.create()

      yield* Effect.promise(async () => {
        expect((await api.experimental.widget.template.list()).map((template) => template.name)).toEqual([
          "confirm",
          "form",
          "suggestions",
        ])
        const latest: unknown = await api.experimental.widget.template.latest({ name: "confirm" })
        expect(latest).toEqual({
          ...confirm,
          program: program(confirm.source),
        })

        const versioned = await handler(
          new Request(`http://opencode.local/api/experimental/widget/template/confirm/${confirm.version}`),
        )
        expect(versioned.status).toBe(200)
        expect(versioned.headers.get("cache-control")).toBe("public, max-age=31536000, immutable")
        expect(await versioned.json()).toMatchObject({ data: { name: "confirm", program: program(confirm.source) } })
        await expect(
          api.experimental.widget.template.get({ name: "confirm", version: "0000000000000000" }),
        ).rejects.toMatchObject({ _tag: "WidgetTemplateNotFoundError", template: "confirm" })

        const template = await api.session.create({ title: "Widgets" })
        await api.experimental.session.import({ info: { ...template, id: sessionID }, messages: [widget] })
        const respond = (
          messageID: string,
          payload: Parameters<typeof api.experimental.session.widget.respond>[0]["payload"],
        ) => api.experimental.session.widget.respond({ sessionID, messageID, payload })

        await respond(widget.id, { value: { confirmed: true } })
        expect(await api.session.message.get({ sessionID, messageID: widget.id })).toMatchObject({
          type: "widget",
          status: "submitted",
          response: { confirmed: true },
        })
        await expect(respond(widget.id, { dismiss: true })).rejects.toMatchObject({
          _tag: "WidgetAlreadyRespondedError",
          status: "submitted",
        })
        await expect(respond("msg_widget_missing", { dismiss: true })).rejects.toMatchObject({
          _tag: "MessageNotFoundError",
        })
        await expect(
          api.experimental.session.widget.respond({
            sessionID: Session.ID.create(),
            messageID: widget.id,
            payload: { dismiss: true },
          }),
        ).rejects.toMatchObject({ _tag: "SessionNotFoundError" })
      })
    }).pipe(Effect.scoped)
  }),
)
