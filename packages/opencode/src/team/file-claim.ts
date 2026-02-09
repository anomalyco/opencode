import z from "zod"
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Storage } from "@/storage/storage"
import { Log } from "@/util/log"

export namespace FileClaim {
  const log = Log.create({ service: "team.file-claim" })

  export const Claim = z
    .object({
      path: z.string(),
      owner: z.string(),
      time: z.number(),
    })
    .meta({ ref: "FileClaim" })
  export type Claim = z.infer<typeof Claim>

  export const Event = {
    Claimed: BusEvent.define(
      "team.file.claimed",
      z.object({
        teamID: z.string(),
        claim: Claim,
      }),
    ),
    Released: BusEvent.define(
      "team.file.released",
      z.object({
        teamID: z.string(),
        path: z.string(),
        owner: z.string(),
      }),
    ),
  }

  export async function claim(input: { teamID: string; path: string; owner: string }) {
    const claims = await list(input.teamID)
    const existing = claims.find((c) => c.path === input.path)

    if (existing && existing.owner !== input.owner)
      throw new Error(`File ${input.path} already claimed by ${existing.owner}`)

    if (existing) return existing

    const entry: Claim = {
      path: input.path,
      owner: input.owner,
      time: Date.now(),
    }
    claims.push(entry)
    await Storage.write(["team_claims", input.teamID], claims)

    log.info("file claimed", { teamID: input.teamID, path: input.path, owner: input.owner })
    Bus.publish(Event.Claimed, { teamID: input.teamID, claim: entry })
    return entry
  }

  export async function release(input: { teamID: string; path: string; owner: string }) {
    const claims = await list(input.teamID)
    const idx = claims.findIndex((c) => c.path === input.path && c.owner === input.owner)
    if (idx < 0) return

    claims.splice(idx, 1)
    await Storage.write(["team_claims", input.teamID], claims)

    log.info("file released", { teamID: input.teamID, path: input.path, owner: input.owner })
    Bus.publish(Event.Released, { teamID: input.teamID, path: input.path, owner: input.owner })
  }

  export async function releaseAll(input: { teamID: string; owner: string }) {
    const claims = await list(input.teamID)
    const remaining = claims.filter((c) => c.owner !== input.owner)
    await Storage.write(["team_claims", input.teamID], remaining)
  }

  export async function list(teamID: string) {
    return Storage.read<Claim[]>(["team_claims", teamID])
      .then((x) => x || [])
      .catch(() => [])
  }

  export async function owner(teamID: string, filePath: string) {
    const claims = await list(teamID)
    return claims.find((c) => c.path === filePath)?.owner
  }

  export async function forOwner(teamID: string, ownerID: string) {
    const claims = await list(teamID)
    return claims.filter((c) => c.owner === ownerID)
  }
}
