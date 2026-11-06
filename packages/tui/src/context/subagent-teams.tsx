import type { SessionInfo } from "@opencode/client"
import path from "path"
import { createEffect, createSignal } from "solid-js"
import {
  createTeamSlotRepository,
  groupTeams,
  parseTeam,
  promoteTeam,
  teamLocationKey,
  type TeamGroup,
  type TeamSlots,
} from "../subagent-team"
import { useData } from "./data"
import { createSimpleContext } from "./helper"
import { useTuiPaths } from "./runtime"

export const { use: useSubagentTeams, provider: SubagentTeamsProvider } = createSimpleContext({
  name: "SubagentTeams",
  init: () => {
    const data = useData()
    const paths = useTuiPaths()
    const [ready, setReady] = createSignal(false)
    const [slots, setSlots] = createSignal<TeamSlots>({})
    const repository = createTeamSlotRepository(path.join(paths.state, "subagent-teams.json"))

    void repository
      .load()
      .then((value) => setSlots(value))
      .catch(() => undefined)
      .finally(() => setReady(true))

    // A team whose member starts running enters the pinned slots. Already pinned
    // teams keep their order; only a new entry changes the slot order.
    createEffect(() => {
      if (!ready()) return
      const running = data.session.list().filter((session) => data.session.status(session.id) === "running")
      if (running.length === 0) return
      let changed = false
      setSlots((current) => {
        let next = current
        for (const session of running) {
          const team = parseTeam(session.title)
          if (!team) continue
          next = promoteTeam(next, teamLocationKey(session.location), team.name)
        }
        if (next === current) return current
        changed = true
        return next
      })
      if (changed) void repository.save(slots())
    })

    return {
      group(
        sessions: readonly SessionInfo[],
        location: { directory: string; workspaceID?: string },
      ): TeamGroup[] {
        return groupTeams(sessions, slots()[teamLocationKey(location)] ?? [])
      },
    }
  },
})
