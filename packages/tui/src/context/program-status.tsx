import { resolveRenderLib } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { createEffect, createSignal, onCleanup, onMount } from "solid-js"
import { createProgramStatus } from "../program-status"
import { createSimpleContext } from "./helper"
import { useData } from "./data"
import { useRoute } from "./route"
import { useSessionTabs } from "./session-tabs"
import { useLocation } from "./location"
import { useClient } from "./client"

export const {
  context: ProgramStatusContext,
  use: useProgramStatus,
  provider: ProgramStatusProvider,
} = createSimpleContext({
  name: "ProgramStatus",
  init: () => {
    const renderer = useRenderer()
    const data = useData()
    const route = useRoute()
    const tabs = useSessionTabs()
    const location = useLocation()
    const client = useClient()
    const [auth, setAuth] = createSignal(0)
    const reporter = createProgramStatus((sequence) => {
      if (!process.stdout.isTTY) return
      resolveRenderLib().writeOut(renderer.rendererPtr, sequence)
    })
    createEffect(() => {
      const selected =
        route.data.type === "session" && route.data.sessionID !== "dummy" ? route.data.sessionID : undefined
      const roots = new Set([
        ...(selected ? [data.session.root(selected)] : []),
        ...(tabs.enabled() ? tabs.tabs().map((tab) => tab.sessionID) : []),
      ])
      const ids = new Set(Array.from(roots).flatMap((id) => [id, ...data.session.family(id)]))
      // Background subagents may already be blocked when this client attaches, before any request event arrives.
      ids.forEach((id) => {
        if (client.connection.status() !== "connected") return
        if (data.session.status(id) !== "running") return
        void Promise.allSettled([data.session.permission.sync(id), data.session.form.sync(id)])
      })
      reporter.update(
        Array.from(ids).flatMap((id) => {
          const session = data.session.get(id)
          if (!session) return []
          return [
            {
              ...session,
              time: {
                ...session.time,
                viewed: Math.max(
                  session.time.viewed ?? -Infinity,
                  data.session.get(data.session.root(id))?.time.viewed ?? -Infinity,
                ),
              },
              running: data.session.status(id) === "running",
              permission: (data.session.permission.list(id)?.length ?? 0) > 0,
              forms: data.session.form.list(id) ?? [],
            },
          ]
        }),
        data.session.get,
        auth() > 0,
        data.session.form.list("global", location.ref) ?? [],
      )
    })
    const dispose = () => reporter.dispose()
    renderer.once("destroy", dispose)
    onCleanup(() => {
      renderer.off("destroy", dispose)
      dispose()
    })
    return {
      authentication() {
        onMount(() => setAuth((count) => count + 1))
        onCleanup(() => setAuth((count) => count - 1))
      },
    }
  },
})
