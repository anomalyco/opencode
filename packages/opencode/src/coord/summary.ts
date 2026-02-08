import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import z from "zod"
import * as CoordTeam from "./team"
import * as CoordInbox from "./inbox"

export const MemberInbox = z.object({
  name: z.string(),
  unread: z.number(),
  total: z.number(),
}).meta({
  ref: "CoordMemberInbox",
})

export const TeamSummary = z.object({
  team: CoordTeam.TeamConfig,
  inbox: MemberInbox.array(),
}).meta({
  ref: "CoordTeamSummary",
})

export type TeamSummary = z.infer<typeof TeamSummary>

export const Event = {
  Updated: BusEvent.define(
    "coord.summary.updated",
    z.object({
      sessionID: z.string(),
      summary: TeamSummary,
    }),
  ),
}

export async function summarize(sessionID: string, teamID: string) {
  const team = await CoordTeam.getTeam(teamID)
  if (!team) return
  const inbox = await Promise.all(
    team.members.map(async (member) => {
      const messages = await CoordInbox.inbox({ teamID, member: member.name }).catch(() => [])
      const unread = messages.filter((message) => !message.read).length
      return {
        name: member.name,
        unread,
        total: messages.length,
      }
    }),
  )
  const summary = TeamSummary.parse({ team, inbox })
  Bus.publish(Event.Updated, { sessionID, summary })
  return summary
}
