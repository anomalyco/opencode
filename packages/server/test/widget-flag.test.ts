import fs from "node:fs/promises"
import path from "node:path"
import { expect } from "bun:test"
import { OpenCode } from "@opencode/client"
import { Widget } from "@opencode/schema/widget"
import { Effect } from "effect"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

const client = (handler: (request: Request) => Promise<Response>) =>
  OpenCode.make({
    baseUrl: "http://opencode.local",
    fetch: Object.assign((input: string | URL | Request, init?: RequestInit) => handler(new Request(input, init)), {
      preconnect: fetch.preconnect,
    }),
  })

// The widgets plugin is opt-in; `experimental.widgets` in a config file must start and stop it on a running server.
it.live(
  "starts and stops the widgets plugin when experimental.widgets changes in a config file",
  () =>
    Effect.gen(function* () {
      const dir = (yield* tmpdirScoped("opencode-widget-flag-")).path
      const global = path.join(dir, "global")
      const project = path.join(dir, "project")
      const config = path.join(global, "opencode.json")
      yield* Effect.promise(async () => {
        await Promise.all([global, project].map((item) => fs.mkdir(item, { recursive: true })))
        await Bun.write(config, "{}")
      })
      yield* Effect.gen(function* () {
        const handler = yield* ServerFetch.make({
          app: { version: "test" },
          database: { path: path.join(dir, "opencode.db") },
          config: { directory: global, project: false, claude: false },
          models: { fetch: false },
          fs: { filewatcher: true },
        })
        const api = client(handler)
        yield* Effect.promise(async () => {
          const session = await api.session.create({ location: { directory: project } })
          const states = () =>
            api
              .rpc(Widget.Definition)
              .states({ sessionID: session.id }, { location: { directory: project } })
              .then(
                () => "ok",
                (error: { type?: string }) => error.type,
              )
          // Polls a real file watch and config reload, bounded in time rather than attempts.
          const until = async (expected: string) => {
            const deadline = Date.now() + 10_000
            while (Date.now() < deadline) {
              if ((await states()) === expected) return expected
              await Bun.sleep(50)
            }
            return states()
          }

          expect(await until("rpc.unavailable")).toBe("rpc.unavailable")
          await Bun.write(config, JSON.stringify({ experimental: { widgets: true } }))
          expect(await until("ok")).toBe("ok")
          await Bun.write(config, JSON.stringify({ experimental: { widgets: false } }))
          expect(await until("rpc.unavailable")).toBe("rpc.unavailable")
        })
      }).pipe(Effect.scoped)
    }),
  { timeout: 30_000 },
)
