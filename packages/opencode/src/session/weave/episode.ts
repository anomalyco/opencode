import { ulid } from "ulid"
import type { Episode } from "./types"
import { WeaveDB } from "./db"

export namespace WeaveEpisode {
  export async function create(input: {
    sessionID: string
    threadID?: string
    summary: string
    status?: Episode["status"]
    sourceMessageIDs: string[]
  }) {
    const episode: Episode = {
      id: ulid(),
      sessionID: input.sessionID,
      threadID: input.threadID,
      summary: input.summary,
      status: input.status ?? "completed",
      sourceMessageIDs: input.sourceMessageIDs,
      createdAt: Date.now(),
    }
    await WeaveDB.appendEpisode(input.sessionID, episode)
    return episode
  }
}
