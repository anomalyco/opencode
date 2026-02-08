import { Storage } from "@/storage/storage"
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import z from "zod"
import * as CoordTeam from "./team"

export const SessionTeam = z.object({
  sessionID: z.string(),
  teamID: z.string(),
}).meta({
  ref: "CoordSessionTeam",
})

export type SessionTeam = z.infer<typeof SessionTeam>

export const Event = {
  Updated: BusEvent.define(
    "coord.session.updated",
    z.object({
      sessionID: z.string(),
      teamID: z.string(),
    }),
  ),
}

export async function setTeam(sessionID: string, teamID: string) {
  await Storage.write(["coord", "session", sessionID], { sessionID, teamID })
  Bus.publish(Event.Updated, { sessionID, teamID })
  return { sessionID, teamID }
}

export async function getTeam(sessionID: string) {
  return Storage.read<SessionTeam>(["coord", "session", sessionID]).catch(() => undefined)
}

export async function teamInfo(sessionID: string) {
  const link = await getTeam(sessionID)
  if (!link) return
  const team = await CoordTeam.getTeam(link.teamID)
  if (!team) return
  return { link, team }
}

export async function clearTeam(teamID: string) {
  const items = await Storage.list(["coord", "session"])
  const links = await Promise.all(items.map((item) => Storage.read<SessionTeam>(item).catch(() => undefined)))
  const targets = links.filter((link): link is SessionTeam => !!link && link.teamID === teamID)
  await Promise.all(targets.map((link) => Storage.remove(["coord", "session", link.sessionID])))
  return targets.map((link) => link.sessionID)
}
