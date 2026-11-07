import { createData } from "@opencode/client/solid"
import { withMediaRefs, type LocationRef } from "@opencode/client"
import type { Plugin } from "@opencode/plugin/tui"
import type { SessionGoal } from "@opencode/plugin/tui/context"
import { Goal } from "@opencode/schema/goal"
import { onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { createSimpleContext } from "./helper"
import { useClient } from "./client"
import { contextUsage, resolvePart } from "../util/session"

export { locationKey } from "@opencode/client/solid"
export type { FormWithLocation } from "@opencode/client/solid"

export const { use: useData, provider: DataProvider } = createSimpleContext({
  name: "Data",
  init: (props: { directory: string }) => {
    const client = useClient()
    const data = createData({
      // Only the transcript store reads stored media as `media:<hash>` refs; plugins and other callers keep inline bytes.
      api: () => withMediaRefs(client.api),
      event: client.event,
      connection: client.connection,
      directory: props.directory,
    })
    const goal = createGoals({
      // The client is replaced on reconnect, so each read resolves it anew.
      fetch: (sessionID) => {
        const directory = data.session.get(sessionID)?.location.directory
        return client.api.rpc(Goal.Definition).get({ sessionID }, directory ? { location: { directory } } : undefined)
      },
      on: data.on,
    })
    const [generatingTitles, setGeneratingTitles] = createStore<Record<string, boolean | undefined>>({})
    const value = {
      ...data,
      location: {
        ...data.location,
        async sync(ref?: LocationRef) {
          await data.location.syncInfo(ref)
          await Promise.all([data.location.sync(ref), data.location.config.sync(ref)])
        },
      },
      session: {
        ...data.session,
        part: {
          get(sessionID: string, messageID: string, partID: string) {
            const message = data.session.message.get(sessionID, messageID)
            return message?.type === "assistant" ? resolvePart(message, partID) : undefined
          },
        },
        usage(sessionID: string) {
          const session = data.session.get(sessionID)
          if (!session) return
          return contextUsage(
            data.session.message.list(sessionID),
            data.location.model.list(session.location),
            session.revert?.messageID,
          )
        },
        goal: goal.get,
        title: {
          pending: (sessionID: string) => generatingTitles[sessionID] === true,
          async generate(sessionID: string) {
            if (generatingTitles[sessionID]) return
            setGeneratingTitles(sessionID, true)
            await client.api.session
              .update({ sessionID, title: "" })
              .then(() => {
                // The HTTP response can beat the renamed event. Keep pending until the new title is projected locally.
                data.session.invalidate(sessionID)
                return data.session.sync(sessionID)
              })
              .finally(() => setGeneratingTitles(sessionID, undefined))
          },
        },
      },
    }
    value satisfies Plugin.Context["data"]
    return value
  },
})

/**
 * Goals by session, from the goal plugin's RPC: fetched on a session's first read and again when the server
 * reconnects, since changes published meanwhile were missed, and kept current from its `changed` events.
 */
function createGoals(input: {
  fetch: (sessionID: string) => Promise<Goal.State | null>
  on: ReturnType<typeof createData>["on"]
}) {
  // null records a session known to have no goal; a missing key is not loaded yet.
  const [goals, setGoals] = createStore<Record<string, SessionGoal | null>>({})
  // A change that arrives while a fetch is in flight is newer than its reply, so each change or fetch takes a turn.
  const turns = new Map<string, number>()
  const turn = (sessionID: string) => {
    const next = (turns.get(sessionID) ?? 0) + 1
    turns.set(sessionID, next)
    return next
  }
  const set = (sessionID: string, goal: Goal.State | null | undefined) =>
    setGoals(sessionID, goal ? { objective: goal.objective, status: goal.status, reason: goal.reason } : null)
  const load = (sessionID: string) => {
    const current = turn(sessionID)
    // A server without the goal plugin answers with an error, and the session shows no goal.
    void input.fetch(sessionID).then(
      (goal) => {
        if (turns.get(sessionID) === current) set(sessionID, goal)
      },
      () => undefined,
    )
  }
  onCleanup(
    input.on(`rpc.${Goal.Definition.id}.changed`, (event) => {
      const payload = event.data as { sessionID: string; goal: Goal.State | null }
      if (!turns.has(payload.sessionID)) return
      turn(payload.sessionID)
      set(payload.sessionID, payload.goal)
    }),
  )
  onCleanup(input.on("server.connected", () => turns.forEach((_, sessionID) => load(sessionID))))
  return {
    get(sessionID: string) {
      if (!turns.has(sessionID)) load(sessionID)
      return goals[sessionID] ?? undefined
    },
  }
}
