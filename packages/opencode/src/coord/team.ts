import z from "zod"
import path from "path"
import fs from "fs/promises"
import { createHash } from "crypto"
import { Lock } from "@/util/lock"
import { Storage } from "@/storage/storage"
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import * as Paths from "./paths"

const TeamMember = z.object({
  name: z.string(),
  agentId: z.string(),
  agentType: z.string(),
})

export const TeamConfig = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  createdAt: z.string(),
  members: TeamMember.array(),
  metadata: z.record(z.string(), z.any()),
}).meta({
  ref: "CoordTeam",
})

export type TeamConfig = z.infer<typeof TeamConfig>
export type TeamMember = z.infer<typeof TeamMember>

const TeamSummary = TeamConfig.pick({ id: true, name: true, description: true, createdAt: true })

export type TeamSummary = z.infer<typeof TeamSummary>

export const Event = {
  Updated: BusEvent.define(
    "coord.team.updated",
    z.object({
      team: TeamConfig,
    }),
  ),
}

function hashId(name: string, team: string) {
  return createHash("sha256").update(`${name}:${team}`).digest("hex").slice(0, 16)
}

async function readTeam(id: string) {
  const filepath = Paths.teamFile(id)
  const file = Bun.file(filepath)
  if (!(await file.exists())) return
  return TeamConfig.parse(await file.json())
}

async function writeTeam(team: TeamConfig) {
  await fs.mkdir(path.dirname(Paths.teamFile(team.id)), { recursive: true })
  await Bun.write(Paths.teamFile(team.id), JSON.stringify(team, null, 2))
  await Storage.write(["coord", "team", team.id], team)
  Bus.publish(Event.Updated, { team })
  return team
}

async function updateIndex(id: string, info: TeamSummary) {
  await Paths.ensureRoot()
  const key = Paths.indexPath()
  using _ = await Lock.write(key)
  const file = Bun.file(key)
  const data: Record<string, TeamSummary> = (await file.json().catch(() => ({})))
  data[id] = info
  await Bun.write(key, JSON.stringify(data, null, 2))
  await Storage.write(["coord", "team_index"], data)
}

async function removeIndex(id: string) {
  await Paths.ensureRoot()
  const key = Paths.indexPath()
  using _ = await Lock.write(key)
  const file = Bun.file(key)
  const data: Record<string, TeamSummary> = (await file.json().catch(() => ({})))
  delete data[id]
  await Bun.write(key, JSON.stringify(data, null, 2))
  await Storage.write(["coord", "team_index"], data)
}

export async function createTeam(input: { id: string; name: string; description?: string }) {
  await Paths.ensureTeam(input.id)
  const existing = await readTeam(input.id)
  if (existing) throw new Error(`Team "${input.id}" already exists`)
  const now = new Date().toISOString()
  const team: TeamConfig = {
    id: input.id,
    name: input.name,
    description: input.description ?? "",
    createdAt: now,
    members: [],
    metadata: {},
  }
  await writeTeam(team)
  await updateIndex(input.id, TeamSummary.parse(team))
  return team
}

export async function deleteTeam(id: string) {
  const team = await readTeam(id)
  if (!team) return
  if (team.members.length > 0) {
    throw new Error(`Cannot delete team "${id}" with active members`)
  }
  await fs.rm(Paths.teamDir(id), { recursive: true, force: true })
  await Storage.remove(["coord", "team", id])
  await removeIndex(id)
}

export async function listTeams() {
  await Paths.ensureRoot()
  const key = Paths.indexPath()
  using _ = await Lock.read(key)
  const file = Bun.file(key)
  const data = (await file.json().catch(() => ({}))) as Record<string, TeamSummary>
  return Object.values(data).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export async function getTeam(id: string) {
  return readTeam(id)
}

export async function addMember(input: { teamID: string; name: string; agentType: string }) {
  const key = Paths.teamFile(input.teamID)
  using _ = await Lock.write(key)
  const team = await readTeam(input.teamID)
  if (!team) throw new Error(`Team "${input.teamID}" not found`)
  if (team.members.some((m) => m.name === input.name)) {
    throw new Error(`Member "${input.name}" already exists in team "${input.teamID}"`)
  }
  const member: TeamMember = {
    name: input.name,
    agentId: hashId(input.name, input.teamID),
    agentType: input.agentType,
  }
  team.members.push(member)
  await writeTeam(team)
  await ensureInbox({ teamID: input.teamID, name: input.name })
  return member
}

export async function removeMember(input: { teamID: string; name: string }) {
  const key = Paths.teamFile(input.teamID)
  using _ = await Lock.write(key)
  const team = await readTeam(input.teamID)
  if (!team) throw new Error(`Team "${input.teamID}" not found`)
  const index = team.members.findIndex((m) => m.name === input.name)
  if (index === -1) throw new Error(`Member "${input.name}" not found in team "${input.teamID}"`)
  team.members.splice(index, 1)
  await writeTeam(team)
  await fs.rm(Paths.inboxFile(input.teamID, input.name), { force: true })
}

export async function ensureInbox(input: { teamID: string; name: string }) {
  await Paths.ensureTeam(input.teamID)
  const file = Paths.inboxFile(input.teamID, input.name)
  const exists = await Bun.file(file).exists()
  if (!exists) await Bun.write(file, "[]")
}

export async function memberNames(teamID: string) {
  const team = await readTeam(teamID)
  if (!team) return []
  return team.members.map((m) => m.name)
}
