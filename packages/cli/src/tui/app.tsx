import { createCliRenderer } from "@opentui/core"
import { render } from "@opentui/solid"
import * as Effect from "effect/Effect"
import { Daemon } from "../services/daemon"
import { createResource } from "solid-js"

export const App = Effect.acquireUseRelease(
  Effect.promise(() => createCliRenderer()),
  (renderer) =>
    Effect.gen(function* () {
      const daemon = yield* Daemon.Service
      const client = yield* daemon.client()

      return yield* Effect.promise(async () => {
        const exited = new Promise<void>((resolve) => renderer.once("destroy", resolve))
        await render(() => {
          const [sessions] = createResource(() => client.v2.session.list())
          return <text>{sessions()?.data?.data.length}</text>
        }, renderer)
        await exited
      })
    }),
  (renderer) =>
    Effect.sync(() => {
      if (!renderer.isDestroyed) renderer.destroy()
    }),
)
