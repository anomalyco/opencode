import type { SessionInfo } from "@opencode/client/promise"
import { createStore } from "solid-js/store"
import type { ServerCtx } from "@/runtime/server/runtime"
import { pathKey } from "@/workspaces/path-key"

type Entry = { server: string; ctx: ServerCtx; session: SessionInfo }

/** Share the location cache without loading the inbox's historical session indexes. */
export function createSessionBranches() {
  const [state, setState] = createStore<{ settled: Record<string, true> }>({ settled: {} })
  const queued = new Set<string>()
  const queue: Entry[] = []
  const drain = { running: false }

  const run = async () => {
    if (drain.running) return
    drain.running = true

    while (queue.length) {
      // Each lookup runs git on the server; keep the existing inbox concurrency limit.
      await Promise.all(
        queue.splice(0, 4).map((entry) =>
          entry.ctx.data.location.vcs
            .sync(entry.session.location)
            .catch(() => undefined)
            .then(() => setState("settled", locationKey(entry), true)),
        ),
      )
    }

    drain.running = false
  }

  return {
    load: (entries: Entry[]) => {
      entries.forEach((entry) => {
        const key = locationKey(entry)
        if (queued.has(key)) return
        queued.add(key)
        queue.push(entry)
      })
      void run()
    },
    loading: (entry: Entry) =>
      !state.settled[locationKey(entry)] && !entry.ctx.data.location.vcs.info(entry.session.location),
    branch: (entry: Entry) => entry.ctx.data.location.vcs.info(entry.session.location)?.branch.current ?? undefined,
  }
}

function locationKey(entry: Entry) {
  return `${entry.server}\0${pathKey(entry.session.location.directory)}`
}
