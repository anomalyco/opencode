import { expect } from "bun:test"
import path from "node:path"
import { Cause, Effect, Exit } from "effect"
import { Global } from "@opencode/util/global"
import { tmpdirScoped } from "../../core/test/fixture/tmpdir"
import { it } from "../../core/test/lib/effect"
import { ServerFetch } from "../src/fetch"

it.live("invalid sandbox roots prevent the server from starting", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped("opencode-sandbox-server-")
    const result = yield* Effect.exit(
      ServerFetch.make(
        {
          sandbox: { enabled: true, readableRoots: ["relative-root"] },
          password: "secret",
          database: { path: ":memory:" },
          config: { project: false, claude: false },
          models: { fetch: false },
          fs: { filewatcher: false, fff: false },
        },
        {
          overrides: [
            Global.node.replace(
              Global.layerWith({
                home: tmp.path,
                config: path.join(tmp.path, "config"),
                data: path.join(tmp.path, "data"),
                state: path.join(tmp.path, "state"),
                tmp: path.join(tmp.path, "tmp"),
                cache: path.join(tmp.path, "cache"),
              }),
            ),
          ],
        },
      ),
    )
    expect(Exit.isFailure(result)).toBe(true)
    if (Exit.isFailure(result)) expect(Cause.pretty(result.cause)).toContain("Invalid sandbox roots")
  }),
)
