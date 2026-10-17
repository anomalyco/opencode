/** @jsxImportSource @opentui/solid */
import { expect } from "bun:test"
import { OpenCode } from "@opencode/client"
import { Global } from "@opencode/util/global"
import { testRender } from "@opentui/solid"
import { Effect } from "effect"
import path from "node:path"
import { tmpdirScoped } from "../../../core/test/fixture/tmpdir"
import { it } from "../../../core/test/lib/effect"
import { startServer } from "../../../server/test/fixture/server"
import { ClientProvider, useClient } from "../../src/context/client"
import { TestTuiContexts } from "../fixture/tui-environment"

it.live("resolves the server home instead of the remote client's home", () =>
  Effect.gen(function* () {
    const tmp = yield* tmpdirScoped()
    const server = yield* startServer(path.join(tmp.path, "config"))
    const api = OpenCode.make({ baseUrl: server.base, headers: server.headers })
    let client!: ReturnType<typeof useClient>
    function Probe() {
      client = useClient()
      return <box />
    }
    yield* Effect.acquireRelease(
      Effect.promise(() =>
        testRender(() => (
          <TestTuiContexts paths={{ home: "/Users/remote-client" }}>
            <ClientProvider api={api}>
              <Probe />
            </ClientProvider>
          </TestTuiContexts>
        )),
      ),
      (setup) => Effect.sync(() => setup.renderer.destroy()),
    )
    expect(yield* Effect.promise(() => client.resolveServerHome())).toBe(Global.Path.home)
  }),
)
