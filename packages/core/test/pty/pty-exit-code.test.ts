import { expect } from "bun:test"
import { Deferred, Effect, Schema } from "effect"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Bus } from "@opencode/core/bus"
import { Location } from "@opencode/core/location"
import { Pty } from "@opencode/core/pty"
import { tempLocationLayer } from "../fixture/location"
import { testEffect } from "../lib/effect"

const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([Pty.node, Bus.node, Location.node]), [
    Location.node.replace(tempLocationLayer),
  ]),
)
const windowsTest = process.platform === "win32" ? it.live : it.live.skip

// `exit -1073741819` ends cmd with 0xC0000005 (STATUS_ACCESS_VIOLATION), the code a crashed program leaves.
windowsTest(
  "keeps a Windows exit code from 0x80000000 up as the unsigned code",
  () =>
    Effect.gen(function* () {
      const pty = yield* Pty.Service
      const bus = yield* Bus.Service
      const location = yield* Location.Service
      const exited = yield* Deferred.make<unknown>()
      const unsubscribe = yield* bus.listen((event) =>
        event.type === Pty.Event.Exited.type ? Deferred.succeed(exited, event.data) : Effect.void,
      )
      yield* Effect.addFinalizer(() => unsubscribe)
      const info = yield* Effect.acquireRelease(
        pty.create({ command: "cmd.exe", args: ["/d", "/c", "exit -1073741819"], cwd: location.directory }),
        (created) => pty.remove(created.id).pipe(Effect.ignore),
      )

      const event = yield* Deferred.await(exited).pipe(Effect.timeout("10 seconds"))
      expect(event).toEqual({ id: info.id, exitCode: 0xc0000005 })
      expect(Schema.is(Pty.Event.Exited.data)(event)).toBe(true)
      expect(yield* pty.get(info.id)).toMatchObject({ status: "exited", exitCode: 0xc0000005 })
      // GET /api/pty encodes this list; one negative exit code failed the whole response.
      expect(Schema.is(Schema.Array(Pty.Info))(yield* pty.list())).toBe(true)
    }),
  30_000,
)
