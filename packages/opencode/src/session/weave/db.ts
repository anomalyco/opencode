import { Storage } from "@/storage/storage"
import type { ContextSnapshot, Episode, MessageLink, SummaryNode, ThreadDispatch } from "./types"

type WeaveSessionStore = {
  version: number
  sessionID: string
  createdAt: number
  updatedAt: number
  snapshots: ContextSnapshot[]
  episodes: Episode[]
  summaryNodes: SummaryNode[]
  dispatches: ThreadDispatch[]
  messageLinks: MessageLink[]
}

const STORE_VERSION = 1

function key(sessionID: string) {
  return ["weave", "session", sessionID]
}

async function base(sessionID: string): Promise<WeaveSessionStore> {
  return {
    version: STORE_VERSION,
    sessionID,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    snapshots: [],
    episodes: [],
    summaryNodes: [],
    dispatches: [],
    messageLinks: [],
  }
}

export namespace WeaveDB {
  export async function ensure(sessionID: string) {
    try {
      const existing = await Storage.read<WeaveSessionStore>(key(sessionID))
      if (existing.version === STORE_VERSION) return existing
      const migrated = {
        ...existing,
        version: STORE_VERSION,
        updatedAt: Date.now(),
        snapshots: existing.snapshots ?? [],
        episodes: existing.episodes ?? [],
        summaryNodes: existing.summaryNodes ?? [],
        dispatches: existing.dispatches ?? [],
        messageLinks: existing.messageLinks ?? [],
      }
      await Storage.write(key(sessionID), migrated)
      return migrated
    } catch (error) {
      if (Storage.NotFoundError.isInstance(error)) {
        const initial = await base(sessionID)
        await Storage.write(key(sessionID), initial)
        return initial
      }
      throw error
    }
  }

  export async function appendSnapshot(sessionID: string, snapshot: ContextSnapshot) {
    await ensure(sessionID)
    return Storage.update<WeaveSessionStore>(key(sessionID), (draft) => {
      draft.snapshots.push(snapshot)
      draft.updatedAt = Date.now()
    })
  }

  export async function appendDispatch(sessionID: string, dispatch: ThreadDispatch) {
    await ensure(sessionID)
    return Storage.update<WeaveSessionStore>(key(sessionID), (draft) => {
      draft.dispatches.push(dispatch)
      draft.updatedAt = Date.now()
    })
  }

  export async function appendEpisode(sessionID: string, episode: Episode) {
    await ensure(sessionID)
    return Storage.update<WeaveSessionStore>(key(sessionID), (draft) => {
      draft.episodes.push(episode)
      draft.updatedAt = Date.now()
    })
  }

  export async function appendSummaryNode(sessionID: string, node: SummaryNode) {
    await ensure(sessionID)
    return Storage.update<WeaveSessionStore>(key(sessionID), (draft) => {
      draft.summaryNodes.push(node)
      draft.updatedAt = Date.now()
    })
  }

  export async function upsertMessageLink(sessionID: string, opencodeMessageID: string, weaveMessageID: string) {
    await ensure(sessionID)
    return Storage.update<WeaveSessionStore>(key(sessionID), (draft) => {
      const index = draft.messageLinks.findIndex((item) => item.opencodeMessageID === opencodeMessageID)
      const next: MessageLink = {
        opencodeMessageID,
        weaveMessageID,
        linkedAt: Date.now(),
      }
      if (index >= 0) draft.messageLinks[index] = next
      else draft.messageLinks.push(next)
      draft.updatedAt = Date.now()
    })
  }

  export async function resolveWeaveMessageID(sessionID: string, opencodeMessageID: string) {
    const store = await ensure(sessionID)
    return store.messageLinks.find((item) => item.opencodeMessageID === opencodeMessageID)?.weaveMessageID
  }

  export async function read(sessionID: string) {
    return ensure(sessionID)
  }
}
