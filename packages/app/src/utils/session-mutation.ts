import type { ServerSync } from "@/context/server-sync"
import type { Session } from "@opencode-ai/sdk/v2/client"
import type { SessionInfo } from "@opencode-ai/client/promise"
import { produce } from "solid-js/store"
import { normalizeSessionInfo } from "./session"
import { sessionRemovalIDs } from "./session-delete"

export type SessionMutationClient = {
  session: {
    update(input: { sessionID: string; title?: string; directory?: string; time?: { archived: number } }): Promise<unknown>
    delete(input: { sessionID: string; directory: string }): Promise<unknown>
    share(input: { sessionID: string }): Promise<{ data?: { share?: { url?: string } } | null }>
    unshare(input: { sessionID: string }): Promise<unknown>
  }
}

export type SessionMutationSync = {
  session: Pick<ServerSync["session"], "remember" | "evict">
  homeSessions: Pick<ServerSync["homeSessions"], "apply">
  peek: ServerSync["peek"]
}

export function applySession(
  serverSync: SessionMutationSync,
  session: Session,
  type: "session.created" | "session.updated" = "session.updated",
) {
  serverSync.session.remember(session)
  const [, setStore] = serverSync.peek(session.directory, { bootstrap: false })
  setStore(
    produce((draft) => {
      const index = draft.session.findIndex((item) => item.id === session.id)
      if (index === -1) draft.session.push(session)
      if (index !== -1) draft.session[index] = session
    }),
  )
  serverSync.homeSessions.apply({ type, properties: { sessionID: session.id, info: session } })
  return session
}

export function removeSession(
  serverSync: SessionMutationSync,
  sessionID: string,
  directory: string,
  descendantIDs?: Iterable<string>,
) {
  const ids = new Set(descendantIDs ? [sessionID, ...descendantIDs] : [sessionID])
  const [, setStore] = serverSync.peek(directory, { bootstrap: false })
  setStore(produce((draft) => (draft.session = draft.session.filter((item) => !ids.has(item.id)))))
  ids.forEach((id) => {
    serverSync.session.evict(id)
    serverSync.homeSessions.apply({ type: "session.deleted", properties: { sessionID: id } })
  })
  return ids
}

export function createSessionMutation(input: { client: SessionMutationClient; serverSync: SessionMutationSync }) {
  return {
    async rename(session: Session, title: string) {
      await input.client.session.update({ sessionID: session.id, title })
      return applySession(input.serverSync, { ...session, title })
    },
    async archive(session: Session) {
      await input.client.session.update({
        sessionID: session.id,
        directory: session.directory,
        time: { archived: Date.now() },
      })
      removeSession(input.serverSync, session.id, session.directory)
    },
    async delete(session: Session) {
      const [store] = input.serverSync.peek(session.directory, { bootstrap: false })
      const ids = sessionRemovalIDs([...store.session], session.id)
      await input.client.session.delete({ sessionID: session.id, directory: session.directory })
      removeSession(input.serverSync, session.id, session.directory, ids)
      return ids
    },
    async publish(session: Session) {
      const url = (await input.client.session.share({ sessionID: session.id })).data?.share?.url
      if (!url) throw new Error("Session share URL missing")
      applySession(input.serverSync, { ...session, share: { url } })
      return url
    },
    async unpublish(session: Session) {
      await input.client.session.unshare({ sessionID: session.id })
      return applySession(input.serverSync, { ...session, share: undefined })
    },
  }
}
