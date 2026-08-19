import type {
  Message,
  Agent,
  Provider,
  Session,
  Part,
  Config,
  Todo,
  Command,
  PermissionRequest,
  QuestionRequest,
  LspStatus,
  McpStatus,
  McpResource,
  FormatterStatus,
  SessionStatus,
  ProviderListResponse,
  ProviderAuthMethod,
  VcsInfo,
  SnapshotFileDiff,
  ConsoleState,
} from "@opencode-ai/sdk/v2"
import { createStore, produce, reconcile } from "solid-js/store"
import { useProject } from "./project"
import { useEvent } from "./event"
import { useSDK } from "./sdk"
import { useTuiStartup } from "./runtime"
import { createSimpleContext } from "./helper"
import { useExit } from "./exit"
import { useArgs } from "./args"
import { batch, onMount } from "solid-js"
import path from "path"
import { linkParam, parseLinkHeader } from "@opencode-ai/core/util/link-header"
import { useKV } from "./kv"
import { usePermission } from "./permission"
import { boundaryFromMessageResponse } from "@opencode-ai/core/util/revert-boundary"
import {
  evictFromEnd,
  evictFromStart,
  messageBefore,
  messageInsert,
  paginationError,
  windowNewest,
  windowOldest,
} from "../util/pagination"

/** Maximum messages kept in memory per session */
export const MAX_LOADED_MESSAGES = 500
export const MESSAGE_PAGE_SIZE = 100

type SessionOwner = { epoch: number; generation: number }

const emptyConsoleState: ConsoleState = {
  consoleManagedProviders: [],
  switchableOrgCount: 0,
}

function search<T>(items: T[], target: string, key: (item: T) => string) {
  let left = 0
  let right = items.length - 1
  while (left <= right) {
    const middle = Math.floor((left + right) / 2)
    const value = key(items[middle])
    if (value === target) return { found: true, index: middle }
    if (value < target) left = middle + 1
    else right = middle - 1
  }
  return { found: false, index: left }
}

export const {
  context: SyncContext,
  use: useSync,
  provider: SyncProvider,
} = createSimpleContext({
  name: "Sync",
  init: () => {
    const startup = useTuiStartup()
    const kv = useKV()
    const permission = usePermission()
    const [store, setStore] = createStore<{
      status: "loading" | "partial" | "complete"
      provider: Provider[]
      provider_default: Record<string, string>
      provider_next: ProviderListResponse
      console_state: ConsoleState
      capabilities: {
        experimentalBackgroundSubagents: boolean
      }
      provider_auth: Record<string, ProviderAuthMethod[]>
      agent: Agent[]
      command: Command[]
      permission: {
        [sessionID: string]: PermissionRequest[]
      }
      question: {
        [sessionID: string]: QuestionRequest[]
      }
      config: Config
      session: Session[]
      message_page: {
        [sessionID: string]: {
          hasOlder: boolean
          hasNewer: boolean
          loading: boolean
          loadingDirection?: "older" | "newer"
          oldest?: string
          newest?: string
          olderCursor?: string
          newerCursor?: string
          error?: string
        }
      }
      session_status: {
        [sessionID: string]: SessionStatus
      }
      session_diff: {
        [sessionID: string]: SnapshotFileDiff[]
      }
      todo: {
        [sessionID: string]: Todo[]
      }
      message: {
        [sessionID: string]: Message[]
      }
      message_cursor: {
        [messageID: string]: string | undefined
      }
      part: {
        [messageID: string]: Part[]
      }
      lsp: LspStatus[]
      mcp: {
        [key: string]: McpStatus
      }
      mcp_resource: {
        [key: string]: McpResource
      }
      formatter: FormatterStatus[]
      vcs: VcsInfo | undefined
    }>({
      provider_next: {
        all: [],
        default: {},
        connected: [],
      },
      console_state: emptyConsoleState,
      capabilities: {
        experimentalBackgroundSubagents: false,
      },
      provider_auth: {},
      config: {},
      status: "loading",
      agent: [],
      permission: {},
      question: {},
      command: [],
      provider: [],
      provider_default: {},
      session: [],
      message_page: {},
      session_status: {},
      session_diff: {},
      todo: {},
      message: {},
      message_cursor: {},
      part: {},
      lsp: [],
      mcp: {},
      mcp_resource: {},
      formatter: [],
      vcs: undefined,
    })

    const event = useEvent()
    const project = useProject()
    const sdk = useSDK()

    const getRevertMarker = (sessionID: string) => {
      const match = search(store.session, sessionID, (s) => s.id)
      if (!match.found) return undefined
      return store.session[match.index].revert?.messageID
    }

    const pageInfo = (link: string) => {
      const links = parseLinkHeader(link)
      return {
        hasOlder: links.next !== undefined,
        hasNewer: links.prev !== undefined,
        olderCursor: linkParam(links.next, "before"),
        newerCursor: linkParam(links.prev, "after"),
      }
    }

    const edgeCursor = (cursors: Record<string, string | undefined>, id: string | undefined) =>
      id ? cursors[id] : undefined

    const clearRevert = (sessionID: string, expected: { messageID: string; partID?: string }) => {
      setStore(
        "session",
        produce((draft) => {
          const match = search(draft, sessionID, (s) => s.id)
          if (!match.found) return
          const current = draft[match.index]?.revert
          if (current?.messageID !== expected.messageID || current?.partID !== expected.partID) return
          draft[match.index] = { ...draft[match.index], revert: undefined }
        }),
      )
    }

    const messageIndex = (messages: Message[] | undefined, id: string) =>
      messages?.findIndex((item) => item.id === id) ?? -1

    type LoadedMessage = {
      info: Message
      parts: Part[]
      cursor?: string
    }

    type LoadedPage = ReturnType<typeof pageInfo> & {
      items: LoadedMessage[]
      oldest?: string
      newest?: string
    }

    type HydrationTracker = {
      messages: Set<string>
      addedMessages: Set<string>
      removedMessages: Set<string>
      clearedMessageParts: Set<string>
      parts: Set<string>
      removedParts: Set<string>
      sessionUpdated: boolean
      revertUpdated: boolean
    }

    const createHydrationTracker = (): HydrationTracker => ({
      messages: new Set(),
      addedMessages: new Set(),
      removedMessages: new Set(),
      clearedMessageParts: new Set(),
      parts: new Set(),
      removedParts: new Set(),
      sessionUpdated: false,
      revertUpdated: false,
    })

    const mergeHydratedItems = (
      incoming: LoadedMessage[],
      messages: Message[],
      parts: Record<string, Part[] | undefined>,
      cursors: Record<string, string | undefined>,
      tracker: HydrationTracker,
    ) => {
      const currentByID = new Map(messages.map((message) => [message.id, message]))
      const merged = incoming.flatMap((message): LoadedMessage[] => {
        if (tracker.removedMessages.has(message.info.id)) return []
        const currentInfo = currentByID.get(message.info.id)
        const currentParts = parts[message.info.id] ?? []
        const nextParts = tracker.clearedMessageParts.has(message.info.id)
          ? []
          : message.parts.flatMap((part) => {
              if (tracker.removedParts.has(part.id)) return []
              const current = currentParts.find((item) => item.id === part.id)
              if (tracker.parts.has(part.id) && current) return [current]
              if (
                current &&
                (part.type === "text" || part.type === "reasoning") &&
                (current.type === "text" || current.type === "reasoning") &&
                part.text.length === 0 &&
                current.text.length > 0
              )
                return [current]
              return [part]
            })
        nextParts.push(
          ...currentParts.filter(
            (part) =>
              tracker.parts.has(part.id) &&
              !tracker.removedParts.has(part.id) &&
              !nextParts.some((item) => item.id === part.id),
          ),
        )
        return [
          {
            info: tracker.messages.has(message.info.id) && currentInfo ? currentInfo : message.info,
            parts: nextParts,
            cursor: tracker.messages.has(message.info.id)
              ? (cursors[message.info.id] ?? message.cursor)
              : message.cursor,
          },
        ]
      })
      return merged
    }

    const hasUnmatchedAdditions = (incoming: LoadedMessage[], messages: Message[], tracker: HydrationTracker) => {
      const incomingIDs = new Set(incoming.map((message) => message.info.id))
      const currentIDs = new Set(messages.map((message) => message.id))
      return [...tracker.addedMessages].some(
        (id) => currentIDs.has(id) && !tracker.removedMessages.has(id) && !incomingIDs.has(id),
      )
    }

    const requireNewMessages = (continuationCursor: string | undefined, incoming: number, unseen: number) => {
      if (continuationCursor && (incoming === 0 || unseen === 0))
        throw new Error("Message pagination returned no new messages")
    }

    const walkOlderPages = async (input: {
      sessionID: string
      cursor: string
      items: LoadedMessage[]
      terminalOnly?: boolean
      retain?: { limit: number; pinned?: string }
      stop?: (items: LoadedMessage[]) => boolean
    }) => {
      const cursors = new Set<string>()
      const ids = new Set(input.items.map((item) => item.info.id))
      let items = input.items
      let removedNewer = false
      let info: ReturnType<typeof pageInfo> = {
        hasOlder: true,
        hasNewer: false,
        olderCursor: input.cursor,
        newerCursor: undefined,
      }
      let cursor: string | undefined = input.cursor
      while (cursor) {
        if (cursors.has(cursor)) throw new Error("Message pagination cursor did not advance")
        cursors.add(cursor)
        const page = await sdk.client.session.messages(
          { sessionID: input.sessionID, before: cursor, limit: MESSAGE_PAGE_SIZE },
          { throwOnError: true },
        )
        const incoming = page.data ?? []
        info = pageInfo(page.response.headers.get("link") ?? "")
        const unseen = incoming.filter((item) => !ids.has(item.info.id))
        incoming.forEach((item) => ids.add(item.info.id))
        items = input.terminalOnly ? incoming : [...incoming, ...items]
        if (input.retain && items.length > input.retain.limit) {
          const retained = items.map((item) => item.info)
          const removed = evictFromEnd(retained, retained.length - input.retain.limit, input.retain.pinned)
          if (removed.length > 0) removedNewer = true
          const retainedIDs = new Set(retained.map((message) => message.id))
          items = items.filter((item) => retainedIDs.has(item.info.id))
        }
        if (input.stop?.(items)) break
        requireNewMessages(info.olderCursor, incoming.length, unseen.length)
        if (info.olderCursor === cursor) throw new Error("Message pagination cursor did not advance")
        cursor = info.olderCursor
      }
      return { items, info, removedNewer }
    }

    const insertLoadedMessage = (items: LoadedMessage[], message: LoadedMessage) => {
      let left = 0
      let right = items.length
      while (left < right) {
        const middle = Math.floor((left + right) / 2)
        const current = items[middle]
        if (!current) break
        if (messageBefore(current.info, message.info)) left = middle + 1
        else right = middle
      }
      const found = left < items.length && items[left]?.info.id === message.info.id
      if (!found) items.splice(left, 0, message)
    }

    // A part-level revert keeps the boundary message itself visible (with trimmed parts), so
    // a user boundary counts as the visible user and no older history is required to render it.
    const hasUserBeforeLoadedBoundary = (items: LoadedMessage[], boundary: Message, partID?: string) =>
      items.some(
        (item) =>
          item.info.role === "user" &&
          (messageBefore(item.info, boundary) || (item.info.id === boundary.id && !!partID)),
      )

    const loadLatestPage = async (
      sessionID: string,
      revert?: { messageID: string; partID?: string },
    ): Promise<LoadedPage> => {
      const latest = await sdk.client.session.messages({ sessionID, limit: MESSAGE_PAGE_SIZE }, { throwOnError: true })
      const latestItems = [...(latest.data ?? [])]
      const latestPage = pageInfo(latest.response.headers.get("link") ?? "")
      const latestOldest = latestItems.at(0)?.info.id
      const latestNewest = latestItems.at(-1)?.info.id
      if (!revert?.messageID) {
        return {
          items: latestItems,
          oldest: latestOldest,
          newest: latestNewest,
          ...latestPage,
        }
      }

      try {
        const response = await sdk.client.session.message(
          { sessionID, messageID: revert.messageID },
          { throwOnError: false },
        )
        const boundary = boundaryFromMessageResponse(response)
        if (!boundary) {
          clearRevert(sessionID, revert)
          return {
            items: latestItems,
            oldest: latestOldest,
            newest: latestNewest,
            ...latestPage,
          }
        }

        insertLoadedMessage(latestItems, boundary)
        const boundaryCursor = boundary.cursor ?? latestPage.olderCursor
        if (hasUserBeforeLoadedBoundary(latestItems, boundary.info, revert.partID)) {
          return {
            items: latestItems,
            oldest: latestItems.at(0)?.info.id,
            newest: latestNewest ?? latestItems.at(-1)?.info.id,
            hasOlder: !!boundaryCursor,
            hasNewer: false,
            olderCursor: boundaryCursor,
            newerCursor: undefined,
          }
        }

        if (!boundaryCursor)
          return {
            items: latestItems,
            oldest: latestItems.at(0)?.info.id,
            newest: latestNewest,
            hasOlder: false,
            hasNewer: false,
            olderCursor: undefined,
            newerCursor: undefined,
          }
        const older = await walkOlderPages({
          sessionID,
          cursor: boundaryCursor,
          items: latestItems,
          retain: { limit: MESSAGE_PAGE_SIZE, pinned: boundary.info.id },
          stop: (items) => hasUserBeforeLoadedBoundary(items, boundary.info, revert.partID),
        })
        const newest = windowNewest(
          older.items.map((item) => item.info),
          boundary.info.id,
        )
        const newerCursor = older.removedNewer
          ? (older.items.find((item) => item.info.id === newest)?.cursor ?? older.info.newerCursor)
          : undefined
        return {
          items: older.items,
          hasOlder: older.info.hasOlder,
          hasNewer: newerCursor !== undefined,
          olderCursor: older.info.olderCursor,
          newerCursor,
          oldest: older.items.at(0)?.info.id,
          newest: latestNewest ?? older.items.at(-1)?.info.id,
        }
      } catch (e) {
        console.error("Revert marker fetch failed during latest-page load", {
          messageID: revert.messageID,
          error: paginationError(e),
        })
        throw e
      }
    }

    const fullSyncedSessions = new Set<string>()
    const syncingSessions = new Map<string, Promise<void>>()
    const hydratingSessions = new Map<string, HydrationTracker>()
    const touchMessage = (sessionID: string, messageID: string, added = false) => {
      const tracker = hydratingSessions.get(sessionID)
      if (!tracker) return
      tracker.messages.add(messageID)
      tracker.removedMessages.delete(messageID)
      if (added) tracker.addedMessages.add(messageID)
    }
    const removeMessage = (sessionID: string, messageID: string) => {
      const tracker = hydratingSessions.get(sessionID)
      if (!tracker) return
      tracker.messages.delete(messageID)
      tracker.addedMessages.delete(messageID)
      tracker.removedMessages.add(messageID)
      tracker.clearedMessageParts.add(messageID)
    }
    const touchPart = (sessionID: string, partID: string) => {
      const tracker = hydratingSessions.get(sessionID)
      if (!tracker) return
      tracker.parts.add(partID)
      tracker.removedParts.delete(partID)
    }
    const removePart = (sessionID: string, partID: string) => {
      const tracker = hydratingSessions.get(sessionID)
      if (!tracker) return
      tracker.parts.delete(partID)
      tracker.removedParts.add(partID)
    }
    const loadingGuard = new Map<string, SessionOwner>()
    const pendingLatest = new Map<string, SessionOwner>()
    const deletedSessions = new Map<string, number>()
    const sessionGenerations = new Map<string, number>()
    let syncEpoch = 0
    const sessionGeneration = (sessionID: string) => sessionGenerations.get(sessionID) ?? 0
    const advanceSessionGeneration = (sessionID: string) =>
      sessionGenerations.set(sessionID, sessionGeneration(sessionID) + 1)
    const sessionOwner = (sessionID: string) => ({ epoch: syncEpoch, generation: sessionGeneration(sessionID) })
    const ownsSession = (sessionID: string, owner: SessionOwner) =>
      owner.epoch === syncEpoch && owner.generation === sessionGeneration(sessionID)
    const staleSession = (sessionID: string, owner: SessionOwner) =>
      !ownsSession(sessionID, owner) || deletedSessions.has(sessionID)
    const queueLatest = (sessionID: string) => pendingLatest.set(sessionID, sessionOwner(sessionID))
    const consumeLatest = (sessionID: string, owner: SessionOwner) => {
      const pending = pendingLatest.get(sessionID)
      if (!pending || pending.epoch !== owner.epoch || pending.generation !== owner.generation) return false
      pendingLatest.delete(sessionID)
      return true
    }
    const acceptSession = (session: Session) => {
      const deleted = deletedSessions.get(session.id)
      if (deleted === undefined) return true
      if (session.time.created <= deleted) return false
      advanceSessionGeneration(session.id)
      deletedSessions.delete(session.id)
      return true
    }

    function sessionListQuery(): { scope?: "project"; path?: string } {
      if (!kv.get("session_directory_filter_enabled", true)) return { scope: "project" }
      if (!project.data.instance.path.worktree || !project.data.instance.path.directory) return { scope: "project" }
      return {
        path: path
          .relative(path.resolve(project.data.instance.path.worktree), project.data.instance.path.directory)
          .replaceAll("\\", "/"),
      }
    }

    function listSessions() {
      return sdk.client.session
        .list({ start: Date.now() - 30 * 24 * 60 * 60 * 1000, ...sessionListQuery() })
        .then((x) => (x.data ?? []).toSorted((a, b) => a.id.localeCompare(b.id)))
    }

    event.subscribe((event, { directory, workspace }) => {
      const eventSessionID =
        "sessionID" in event.properties && typeof event.properties.sessionID === "string"
          ? event.properties.sessionID
          : undefined
      if (
        eventSessionID &&
        deletedSessions.has(eventSessionID) &&
        event.type !== "session.created" &&
        event.type !== "session.deleted"
      )
        return
      switch (event.type) {
        case "server.instance.disposed":
          const synced = [
            ...new Set([...fullSyncedSessions, ...Object.keys(store.message), ...Object.keys(store.message_page)]),
          ]
          syncEpoch += 1
          fullSyncedSessions.clear()
          syncingSessions.clear()
          hydratingSessions.clear()
          loadingGuard.clear()
          pendingLatest.clear()
          sessionGenerations.clear()
          setStore(
            produce((draft) => {
              draft.message = {}
              draft.message_page = {}
              draft.message_cursor = {}
              draft.part = {}
              draft.todo = {}
              draft.session_diff = {}
              draft.session_status = {}
              draft.permission = {}
              draft.question = {}
            }),
          )
          void bootstrap().then(() => Promise.allSettled(synced.map((sessionID) => result.session.sync(sessionID))))
          break
        case "permission.replied": {
          const requests = store.permission[event.properties.sessionID]
          if (!requests) break
          const match = search(requests, event.properties.requestID, (r) => r.id)
          if (!match.found) break
          setStore(
            "permission",
            event.properties.sessionID,
            produce((draft) => {
              draft.splice(match.index, 1)
            }),
          )
          break
        }

        case "permission.asked": {
          const request = event.properties
          if (permission.mode === "auto") {
            void sdk.client.permission.reply({
              requestID: request.id,
              reply: "once",
              directory,
              workspace,
            })
            break
          }
          const requests = store.permission[request.sessionID]
          if (!requests) {
            setStore("permission", request.sessionID, [request])
            break
          }
          const match = search(requests, request.id, (r) => r.id)
          if (match.found) {
            setStore("permission", request.sessionID, match.index, reconcile(request))
            break
          }
          setStore(
            "permission",
            request.sessionID,
            produce((draft) => {
              draft.splice(match.index, 0, request)
            }),
          )
          break
        }

        case "question.replied":
        case "question.rejected": {
          const requests = store.question[event.properties.sessionID]
          if (!requests) break
          const match = search(requests, event.properties.requestID, (r) => r.id)
          if (!match.found) break
          setStore(
            "question",
            event.properties.sessionID,
            produce((draft) => {
              draft.splice(match.index, 1)
            }),
          )
          break
        }

        case "question.asked": {
          const request = event.properties
          const requests = store.question[request.sessionID]
          if (!requests) {
            setStore("question", request.sessionID, [request])
            break
          }
          const match = search(requests, request.id, (r) => r.id)
          if (match.found) {
            setStore("question", request.sessionID, match.index, reconcile(request))
            break
          }
          setStore(
            "question",
            request.sessionID,
            produce((draft) => {
              draft.splice(match.index, 0, request)
            }),
          )
          break
        }

        case "todo.updated":
          setStore("todo", event.properties.sessionID, event.properties.todos)
          break

        case "session.diff":
          setStore("session_diff", event.properties.sessionID, event.properties.diff)
          break

        case "session.deleted": {
          const sessionID = event.properties.info.id
          advanceSessionGeneration(sessionID)
          deletedSessions.set(sessionID, event.properties.info.time.created)
          fullSyncedSessions.delete(sessionID)
          syncingSessions.delete(sessionID)
          hydratingSessions.delete(sessionID)
          loadingGuard.delete(sessionID)
          pendingLatest.delete(sessionID)
          const result = search(store.session, sessionID, (s) => s.id)
          if (result.found) {
            setStore(
              "session",
              produce((draft) => {
                draft.splice(result.index, 1)
              }),
            )
          }
          setStore(
            produce((draft) => {
              for (const message of draft.message[sessionID] ?? []) {
                delete draft.part[message.id]
                delete draft.message_cursor[message.id]
              }
              delete draft.message[sessionID]
              delete draft.message_page[sessionID]
              delete draft.todo[sessionID]
              delete draft.session_diff[sessionID]
              delete draft.session_status[sessionID]
              delete draft.permission[sessionID]
              delete draft.question[sessionID]
            }),
          )
          break
        }
        case "session.created": {
          const info = event.properties.info
          const deleted = deletedSessions.has(info.id)
          const match = search(store.session, info.id, (session) => session.id)
          const recreated = deleted || (match.found && store.session[match.index].time.created !== info.time.created)
          if (recreated) advanceSessionGeneration(info.id)
          deletedSessions.delete(info.id)
          if (match.found) {
            setStore("session", match.index, reconcile(info))
            break
          }
          setStore(
            "session",
            produce((draft) => {
              draft.splice(match.index, 0, info)
            }),
          )
          break
        }
        case "session.updated": {
          const info = event.properties.info
          if (deletedSessions.has(info.id)) break
          const match = search(store.session, info.id, (s) => s.id)
          const previous = match.found ? store.session[match.index] : undefined
          const revertChanged =
            previous?.revert?.messageID !== info.revert?.messageID || previous?.revert?.partID !== info.revert?.partID
          const tracker = hydratingSessions.get(info.id)
          if (tracker) {
            tracker.sessionUpdated = true
            if (revertChanged) {
              tracker.revertUpdated = true
              queueLatest(info.id)
            }
          }
          if (match.found) {
            setStore("session", match.index, reconcile(info))
            if (revertChanged && !tracker && store.message[info.id])
              void result.session.jumpToLatest(info.id, { force: true })
            break
          }
          setStore(
            "session",
            produce((draft) => {
              draft.splice(match.index, 0, info)
            }),
          )
          break
        }

        case "session.next.moved": {
          const result = search(store.session, event.properties.sessionID, (s) => s.id)
          if (!result.found) break
          setStore(
            "session",
            result.index,
            produce((session) => {
              session.directory = event.properties.location.directory
              session.path = event.properties.subdirectory
              session.workspaceID = event.properties.location.workspaceID
              session.time.updated = event.properties.timestamp
            }),
          )
          break
        }

        case "session.status": {
          setStore("session_status", event.properties.sessionID, event.properties.status)
          break
        }

        case "message.updated": {
          const sessionID = event.properties.info.sessionID
          const page = store.message_page[sessionID]
          const messages = store.message[sessionID]
          const pinned = getRevertMarker(sessionID)
          if (!messages) {
            touchMessage(sessionID, event.properties.info.id, true)
            setStore("message", sessionID, [event.properties.info])
            if (event.properties.cursor) setStore("message_cursor", event.properties.info.id, event.properties.cursor)
            break
          }
          const current = messageIndex(messages, event.properties.info.id)
          if (current !== -1) {
            touchMessage(sessionID, event.properties.info.id)
            setStore("message", sessionID, current, reconcile(event.properties.info))
            if (event.properties.cursor) setStore("message_cursor", event.properties.info.id, event.properties.cursor)
            break
          }
          const loadingNewer = page?.loading && page.loadingDirection === "newer"
          const loadingOlder = page?.loading && page.loadingDirection === "older"
          if (page?.hasNewer && !loadingNewer) {
            break
          }
          const oldest = page?.oldest ? messages.find((item) => item.id === page.oldest) : undefined
          if (oldest && messageBefore(event.properties.info, oldest) && !loadingOlder) {
            break
          }
          touchMessage(sessionID, event.properties.info.id, true)
          const result = messageInsert(messages, event.properties.info)
          const preview = [...messages]
          preview.splice(result.index, 0, event.properties.info)
          setStore(
            "message",
            sessionID,
            produce((draft) => {
              draft.splice(result.index, 0, event.properties.info)
            }),
          )
          if (event.properties.cursor) setStore("message_cursor", event.properties.info.id, event.properties.cursor)
          if (page) {
            const nextOldest = windowOldest(preview, pinned) ?? page.oldest
            const nextNewest = windowNewest(preview, pinned) ?? page.newest
            setStore("message_page", event.properties.info.sessionID, {
              ...page,
              newest: nextNewest,
              oldest: nextOldest,
            })
          }
          if (preview.length > MAX_LOADED_MESSAGES) {
            const evictCount = preview.length - MAX_LOADED_MESSAGES
            const trimmed = [...preview]
            const evicted = evictFromStart(trimmed, evictCount, pinned)
            const nextOldest = windowOldest(trimmed, pinned) ?? page?.oldest
            const nextNewest = windowNewest(trimmed, pinned) ?? page?.newest
            batch(() => {
              setStore(
                "message",
                event.properties.info.sessionID,
                produce((draft) => {
                  evictFromStart(draft, evictCount, pinned)
                }),
              )
              setStore(
                "part",
                produce((draft) => {
                  for (const msg of evicted) {
                    delete draft[msg.id]
                  }
                }),
              )
              setStore(
                "message_cursor",
                produce((draft) => {
                  for (const msg of evicted) {
                    delete draft[msg.id]
                  }
                }),
              )
              if (page) {
                setStore("message_page", event.properties.info.sessionID, {
                  ...page,
                  hasOlder: true,
                  oldest: nextOldest,
                  newest: nextNewest,
                  olderCursor: edgeCursor(store.message_cursor, nextOldest) ?? page.olderCursor,
                })
              }
            })
          }
          break
        }
        case "message.removed": {
          removeMessage(event.properties.sessionID, event.properties.messageID)
          const messages = store.message[event.properties.sessionID]
          const page = store.message_page[event.properties.sessionID]
          const pinned = getRevertMarker(event.properties.sessionID)
          const index = messageIndex(messages, event.properties.messageID)
          if (index !== -1) {
            const preview = [...messages]
            preview.splice(index, 1)
            const nextOldest = windowOldest(preview, pinned) ?? preview.at(0)?.id
            const nextNewest = windowNewest(preview, pinned) ?? preview.at(-1)?.id
            const onlyPinned = preview.length === 1 && preview[0]?.id === pinned
            setStore(
              produce((draft) => {
                draft.message[event.properties.sessionID]?.splice(index, 1)
                delete draft.part[event.properties.messageID]
                delete draft.message_cursor[event.properties.messageID]
                if (page) {
                  draft.message_page[event.properties.sessionID] = {
                    ...page,
                    oldest: nextOldest,
                    newest: nextNewest,
                    olderCursor: page.hasOlder
                      ? preview.length > 0 && !onlyPinned
                        ? edgeCursor(draft.message_cursor, nextOldest)
                        : page.olderCursor
                      : undefined,
                    newerCursor: page.hasNewer
                      ? preview.length > 0 && !onlyPinned
                        ? edgeCursor(draft.message_cursor, nextNewest)
                        : page.newerCursor
                      : undefined,
                  }
                }
              }),
            )
          }
          break
        }
        case "message.part.updated": {
          const sessionID = event.properties.part.sessionID
          const page = store.message_page[sessionID]
          const messages = store.message[sessionID]
          const messageExists = messages?.some((m) => m.id === event.properties.part.messageID)
          const loadingNewer = page?.loading && page.loadingDirection === "newer"
          if (!messageExists && !loadingNewer) {
            break
          }
          const parts = store.part[event.properties.part.messageID]
          if (!parts) {
            touchPart(sessionID, event.properties.part.id)
            setStore("part", event.properties.part.messageID, [event.properties.part])
            break
          }
          const result = search(parts, event.properties.part.id, (part) => part.id)
          if (result.found) {
            touchPart(sessionID, event.properties.part.id)
            setStore("part", event.properties.part.messageID, result.index, reconcile(event.properties.part))
            break
          }
          touchPart(sessionID, event.properties.part.id)
          setStore(
            "part",
            event.properties.part.messageID,
            produce((draft) => {
              draft.splice(result.index, 0, event.properties.part)
            }),
          )
          break
        }

        case "message.part.delta": {
          const parts = store.part[event.properties.messageID]
          if (!parts) break
          const result = search(parts, event.properties.partID, (part) => part.id)
          if (!result.found) break
          touchPart(event.properties.sessionID, event.properties.partID)
          setStore(
            "part",
            event.properties.messageID,
            produce((draft) => {
              const part = draft[result.index]
              const field = event.properties.field as keyof typeof part
              const existing = part[field] as string | undefined
              ;(part[field] as string) = (existing ?? "") + event.properties.delta
            }),
          )
          break
        }

        case "message.part.removed": {
          removePart(event.properties.sessionID, event.properties.partID)
          const parts = store.part[event.properties.messageID]
          if (!parts) break
          const result = search(parts, event.properties.partID, (part) => part.id)
          if (result.found) {
            setStore(
              "part",
              event.properties.messageID,
              produce((draft) => {
                draft.splice(result.index, 1)
              }),
            )
          }
          break
        }

        case "lsp.updated": {
          const workspace = project.workspace.current()
          void sdk.client.lsp.status({ workspace }).then((x) => setStore("lsp", x.data ?? []))
          break
        }

        case "vcs.branch.updated": {
          if (workspace === project.workspace.current()) {
            setStore("vcs", { branch: event.properties.branch })
          }
          break
        }
      }
    })

    const exit = useExit()
    const args = useArgs()

    async function bootstrap(input: { fatal?: boolean } = {}) {
      const fatal = input.fatal ?? true
      const workspace = project.workspace.current()
      const projectPromise = project.sync()
      const sessionListPromise = projectPromise.then(() => listSessions())

      // blocking - include session.list when continuing a session
      const providersPromise = sdk.client.config.providers({ workspace }, { throwOnError: true })
      const providerListPromise = sdk.client.provider.list({ workspace }, { throwOnError: true })
      const capabilitiesPromise = sdk.client.experimental.capabilities
        .get({ workspace }, { throwOnError: true })
        .then((x) => x.data)
        .catch(() => undefined)
      const consoleStatePromise = sdk.client.experimental.console
        .get({ workspace }, { throwOnError: true })
        .then((x) => x.data)
        .catch(() => emptyConsoleState)
      const agentsPromise = sdk.client.app.agents({ workspace }, { throwOnError: true })
      const configPromise = sdk.client.config.get({ workspace }, { throwOnError: true })
      await Promise.all([
        providersPromise,
        providerListPromise,
        capabilitiesPromise,
        agentsPromise,
        configPromise,
        projectPromise,
        ...(args.continue ? [sessionListPromise] : []),
      ])
        .then(async () => {
          const providersResponse = providersPromise.then((x) => x.data!)
          const providerListResponse = providerListPromise.then((x) => x.data!)
          const capabilitiesResponse = capabilitiesPromise
          const consoleStateResponse = consoleStatePromise
          const agentsResponse = agentsPromise.then((x) => x.data ?? [])
          const configResponse = configPromise.then((x) => x.data!)
          const sessionListResponse = args.continue ? sessionListPromise : undefined

          return Promise.all([
            providersResponse,
            providerListResponse,
            capabilitiesResponse,
            consoleStateResponse,
            agentsResponse,
            configResponse,
            ...(sessionListResponse ? [sessionListResponse] : []),
          ]).then((responses) => {
            const providers = responses[0]
            const providerList = responses[1]
            const capabilities = responses[2]
            const consoleState = responses[3]
            const agents = responses[4]
            const config = responses[5]
            const sessions = responses[6]

            batch(() => {
              setStore("provider", reconcile(providers.providers))
              setStore("provider_default", reconcile(providers.default))
              setStore("provider_next", reconcile(providerList))
              setStore("capabilities", "experimentalBackgroundSubagents", capabilities?.backgroundSubagents === true)
              setStore("console_state", reconcile(consoleState))
              setStore("agent", reconcile(agents))
              setStore("config", reconcile(config))
              if (sessions !== undefined) setStore("session", reconcile(sessions.filter(acceptSession)))
            })
          })
        })
        .then(() => {
          if (store.status !== "complete") setStore("status", "partial")
          // non-blocking
          void Promise.all([
            ...(args.continue
              ? []
              : [
                  sessionListPromise.then((sessions) => setStore("session", reconcile(sessions.filter(acceptSession)))),
                ]),
            consoleStatePromise.then((consoleState) => setStore("console_state", reconcile(consoleState))),
            sdk.client.command.list({ workspace }).then((x) => setStore("command", reconcile(x.data ?? []))),
            sdk.client.lsp.status({ workspace }).then((x) => setStore("lsp", reconcile(x.data ?? []))),
            sdk.client.mcp.status({ workspace }).then((x) => setStore("mcp", reconcile(x.data ?? {}))),
            sdk.client.experimental.resource
              .list({ workspace })
              .then((x) => setStore("mcp_resource", reconcile(x.data ?? {}))),
            sdk.client.formatter.status({ workspace }).then((x) => setStore("formatter", reconcile(x.data ?? []))),
            sdk.client.session.status({ workspace }).then((x) => {
              setStore(
                "session_status",
                reconcile(
                  Object.fromEntries(
                    Object.entries(x.data ?? {}).filter(([sessionID]) => !deletedSessions.has(sessionID)),
                  ),
                ),
              )
            }),
            sdk.client.provider.auth({ workspace }).then((x) => setStore("provider_auth", reconcile(x.data ?? {}))),
            sdk.client.vcs.get({ workspace }).then((x) => setStore("vcs", reconcile(x.data))),
            project.workspace.sync(),
          ]).then(() => {
            setStore("status", "complete")
          })
        })
        .catch(async (e) => {
          console.error("tui bootstrap failed", {
            error: paginationError(e),
            name: e instanceof Error ? e.name : undefined,
            stack: e instanceof Error ? e.stack : undefined,
          })
          if (fatal) {
            exit(e)
          } else {
            throw e
          }
        })
    }

    onMount(() => {
      void bootstrap()
    })

    const result = {
      data: store,
      set: setStore,
      get status() {
        return store.status
      },
      get ready() {
        if (startup.skipInitialLoading) return true
        return store.status !== "loading"
      },
      get path() {
        return project.instance.path()
      },
      session: {
        get(sessionID: string) {
          const match = search(store.session, sessionID, (s) => s.id)
          if (match.found) return store.session[match.index]
          return undefined
        },
        query() {
          return sessionListQuery()
        },
        async refresh() {
          const list = await listSessions()
          setStore("session", reconcile(list.filter(acceptSession)))
        },
        status(sessionID: string) {
          const session = result.session.get(sessionID)
          if (!session) return "idle"
          if (session.time.compacting) return "compacting"
          const messages = store.message[sessionID] ?? []
          const last = messages.at(-1)
          if (!last) return "idle"
          if (last.role === "user") return "working"
          return last.time.completed ? "idle" : "working"
        },
        async sync(sessionID: string) {
          if (fullSyncedSessions.has(sessionID)) return
          const syncing = syncingSessions.get(sessionID)
          if (syncing) return syncing
          const owner = sessionOwner(sessionID)
          const tracker = createHydrationTracker()
          hydratingSessions.set(sessionID, tracker)
          const task = (async () => {
            const [session, todo, diff] = await Promise.all([
              sdk.client.session.get({ sessionID }, { throwOnError: true }),
              sdk.client.session.todo({ sessionID }),
              sdk.client.session.diff({ sessionID }),
            ])
            if (staleSession(sessionID, owner)) return
            const sessionInfo = session.data!
            setStore(
              produce((draft) => {
                if (!tracker.sessionUpdated) {
                  const match = search(draft.session, sessionID, (item) => item.id)
                  if (match.found) draft.session[match.index] = sessionInfo
                  if (!match.found) draft.session.splice(match.index, 0, sessionInfo)
                }
                draft.todo[sessionID] = todo.data ?? []
                draft.session_diff[sessionID] = diff.data ?? []
              }),
            )
            const page = await loadLatestPage(sessionID, result.session.get(sessionID)?.revert).catch((error) => {
              if (staleSession(sessionID, owner)) return
              setStore(
                "message_page",
                sessionID,
                store.message_page[sessionID]
                  ? { ...store.message_page[sessionID], loading: false, error: paginationError(error) }
                  : {
                      hasOlder: false,
                      hasNewer: false,
                      loading: false,
                      error: paginationError(error),
                    },
              )
            })
            if (!page || staleSession(sessionID, owner)) return
            const currentMessages = store.message[sessionID] ?? []
            if (tracker.revertUpdated || hasUnmatchedAdditions(page.items, currentMessages, tracker)) {
              queueLatest(sessionID)
              return
            }
            setStore(
              produce((draft) => {
                const currentMessages = draft.message[sessionID] ?? []
                const hydrated = mergeHydratedItems(
                  page.items,
                  currentMessages,
                  draft.part,
                  draft.message_cursor,
                  tracker,
                )
                const visible = hydrated.map((message) => message.info)
                const boundary = result.session.get(sessionID)?.revert?.messageID
                const boundaryIndex = boundary ? visible.findIndex((message) => message.id === boundary) : -1
                const previousUser =
                  boundaryIndex === -1
                    ? undefined
                    : visible.slice(0, boundaryIndex).findLast((message) => message.role === "user")?.id
                const preserved = new Set([boundary, previousUser].filter((id): id is string => !!id))
                const removed = evictFromStart(visible, Math.max(0, visible.length - MESSAGE_PAGE_SIZE), preserved)
                const visibleIDs = new Set(visible.map((message) => message.id))
                for (const message of currentMessages) {
                  if (visibleIDs.has(message.id)) continue
                  delete draft.part[message.id]
                  delete draft.message_cursor[message.id]
                }
                for (const message of hydrated) {
                  if (!visibleIDs.has(message.info.id)) {
                    delete draft.part[message.info.id]
                    delete draft.message_cursor[message.info.id]
                    continue
                  }
                  draft.message_cursor[message.info.id] = message.cursor
                  draft.part[message.info.id] = message.parts
                }
                for (const message of removed) {
                  delete draft.part[message.id]
                  delete draft.message_cursor[message.id]
                }
                draft.message[sessionID] = visible
                const oldest = windowOldest(visible, boundary) ?? page.oldest
                const newest = windowNewest(visible, boundary) ?? page.newest
                draft.message_page[sessionID] = {
                  hasOlder: page.hasOlder || removed.length > 0,
                  hasNewer: page.hasNewer,
                  loading: false,
                  oldest,
                  newest,
                  olderCursor:
                    removed.length > 0
                      ? (edgeCursor(draft.message_cursor, oldest) ?? page.olderCursor)
                      : page.olderCursor,
                  newerCursor: page.newerCursor,
                  error: undefined,
                }
              }),
            )
            if (staleSession(sessionID, owner)) return
            fullSyncedSessions.add(sessionID)
          })().finally(() => {
            if (syncingSessions.get(sessionID) === task) syncingSessions.delete(sessionID)
            if (hydratingSessions.get(sessionID) === tracker) hydratingSessions.delete(sessionID)
            if (consumeLatest(sessionID, owner)) void result.session.jumpToLatest(sessionID, { force: true })
          })
          syncingSessions.set(sessionID, task)
          return task
        },
        async allMessages(sessionID: string) {
          const latest = await sdk.client.session.messages(
            { sessionID, limit: MESSAGE_PAGE_SIZE },
            { throwOnError: true },
          )
          const items = [...(latest.data ?? [])]
          const cursor = pageInfo(latest.response.headers.get("link") ?? "").olderCursor
          if (!cursor) return items
          return (await walkOlderPages({ sessionID, cursor, items })).items
        },
        async loadOlder(sessionID: string) {
          const page = store.message_page[sessionID]
          if (page?.loading || !page?.hasOlder) return
          const cursor = page?.olderCursor
          if (!cursor) return
          if (loadingGuard.has(sessionID)) return
          const owner = sessionOwner(sessionID)
          loadingGuard.set(sessionID, owner)
          const pinned = getRevertMarker(sessionID)
          try {
            setStore("message_page", sessionID, { ...page, loading: true, loadingDirection: "older", error: undefined })

            const res = await sdk.client.session.messages(
              { sessionID, before: cursor, limit: MESSAGE_PAGE_SIZE },
              { throwOnError: true },
            )
            if (staleSession(sessionID, owner)) return
            const info = pageInfo(res.response.headers.get("link") ?? "")
            const incoming = res.data ?? []
            const ids = new Set((store.message[sessionID] ?? []).map((message) => message.id))
            requireNewMessages(
              info.olderCursor,
              incoming.length,
              incoming.filter((message) => !ids.has(message.info.id)).length,
            )
            const next = info.olderCursor === cursor ? { ...info, hasOlder: false, olderCursor: undefined } : info
            setStore(
              produce((draft) => {
                const existing = draft.message[sessionID] ?? []
                const pageOldest = incoming.at(0)?.info.id
                for (const msg of incoming) {
                  draft.message_cursor[msg.info.id] = msg.cursor
                  const match = messageInsert(existing, msg.info)
                  if (!match.found) {
                    existing.splice(match.index, 0, msg.info)
                    draft.part[msg.info.id] = msg.parts
                  }
                }
                const nextOldest = pageOldest ?? draft.message_page[sessionID]?.oldest
                if (existing.length > MAX_LOADED_MESSAGES) {
                  const evictCount = existing.length - MAX_LOADED_MESSAGES
                  const evicted = evictFromEnd(existing, evictCount, pinned)
                  for (const msg of evicted) {
                    delete draft.part[msg.id]
                    delete draft.message_cursor[msg.id]
                  }
                  const nextNewest = windowNewest(existing, pinned) ?? draft.message_page[sessionID]?.newest
                  draft.message_page[sessionID] = {
                    hasOlder: next.hasOlder,
                    hasNewer: true,
                    loading: false,
                    oldest: nextOldest,
                    newest: nextNewest,
                    olderCursor: next.olderCursor,
                    newerCursor:
                      edgeCursor(draft.message_cursor, nextNewest) ?? draft.message_page[sessionID]?.newerCursor,
                    error: undefined,
                  }
                } else {
                  const nextNewest = windowNewest(existing, pinned) ?? draft.message_page[sessionID]?.newest
                  draft.message_page[sessionID] = {
                    hasOlder: next.hasOlder,
                    hasNewer: draft.message_page[sessionID]?.hasNewer ?? false,
                    loading: false,
                    oldest: nextOldest,
                    newest: nextNewest,
                    olderCursor: next.olderCursor,
                    newerCursor: draft.message_page[sessionID]?.newerCursor,
                    error: undefined,
                  }
                }
              }),
            )
          } catch (e) {
            if (staleSession(sessionID, owner)) return
            const page = store.message_page[sessionID]
            setStore("message_page", sessionID, {
              hasOlder: page?.hasOlder ?? false,
              hasNewer: page?.hasNewer ?? false,
              loading: false,
              oldest: page?.oldest,
              newest: page?.newest,
              olderCursor: page?.olderCursor,
              newerCursor: page?.newerCursor,
              error: paginationError(e),
            })
          } finally {
            if (loadingGuard.get(sessionID) === owner) loadingGuard.delete(sessionID)
            if (consumeLatest(sessionID, owner)) void result.session.jumpToLatest(sessionID, { force: true })
          }
        },
        async loadNewer(sessionID: string) {
          const page = store.message_page[sessionID]
          if (page?.loading || !page?.hasNewer) return
          const cursor = page?.newerCursor
          if (!cursor) return result.session.jumpToLatest(sessionID, { force: true })
          if (loadingGuard.has(sessionID)) return
          const owner = sessionOwner(sessionID)
          loadingGuard.set(sessionID, owner)
          const pinned = getRevertMarker(sessionID)
          try {
            setStore("message_page", sessionID, { ...page, loading: true, loadingDirection: "newer", error: undefined })
            const res = await sdk.client.session.messages(
              { sessionID, after: cursor, limit: MESSAGE_PAGE_SIZE },
              { throwOnError: true },
            )
            if (staleSession(sessionID, owner)) return
            const info = pageInfo(res.response.headers.get("link") ?? "")
            const incoming = res.data ?? []
            const ids = new Set((store.message[sessionID] ?? []).map((message) => message.id))
            requireNewMessages(
              info.newerCursor,
              incoming.length,
              incoming.filter((message) => !ids.has(message.info.id)).length,
            )
            const next = info.newerCursor === cursor ? { ...info, hasNewer: false, newerCursor: undefined } : info
            setStore(
              produce((draft) => {
                const existing = draft.message[sessionID] ?? []
                const pageNewest = incoming.at(-1)?.info.id
                for (const msg of incoming) {
                  draft.message_cursor[msg.info.id] = msg.cursor
                  const match = messageInsert(existing, msg.info)
                  if (!match.found) {
                    existing.splice(match.index, 0, msg.info)
                    draft.part[msg.info.id] = msg.parts
                  }
                }
                const nextNewest = pageNewest ?? draft.message_page[sessionID]?.newest
                if (existing.length > MAX_LOADED_MESSAGES) {
                  const evictCount = existing.length - MAX_LOADED_MESSAGES
                  const evicted = evictFromStart(existing, evictCount, pinned)
                  for (const msg of evicted) {
                    delete draft.part[msg.id]
                    delete draft.message_cursor[msg.id]
                  }
                  const nextOldest = windowOldest(existing, pinned) ?? draft.message_page[sessionID]?.oldest
                  draft.message_page[sessionID] = {
                    hasOlder: true,
                    hasNewer: next.hasNewer,
                    loading: false,
                    oldest: nextOldest,
                    newest: nextNewest,
                    olderCursor:
                      edgeCursor(draft.message_cursor, nextOldest) ?? draft.message_page[sessionID]?.olderCursor,
                    newerCursor: next.newerCursor,
                    error: undefined,
                  }
                } else {
                  const nextOldest = windowOldest(existing, pinned) ?? draft.message_page[sessionID]?.oldest
                  draft.message_page[sessionID] = {
                    hasOlder: draft.message_page[sessionID]?.hasOlder ?? false,
                    hasNewer: next.hasNewer,
                    loading: false,
                    oldest: nextOldest,
                    newest: nextNewest,
                    olderCursor: draft.message_page[sessionID]?.olderCursor,
                    newerCursor: next.newerCursor,
                    error: undefined,
                  }
                }
              }),
            )
          } catch (e) {
            if (staleSession(sessionID, owner)) return
            const page = store.message_page[sessionID]
            setStore("message_page", sessionID, {
              hasOlder: page?.hasOlder ?? false,
              hasNewer: page?.hasNewer ?? false,
              loading: false,
              oldest: page?.oldest,
              newest: page?.newest,
              olderCursor: page?.olderCursor,
              newerCursor: page?.newerCursor,
              error: paginationError(e),
            })
          } finally {
            if (loadingGuard.get(sessionID) === owner) loadingGuard.delete(sessionID)
            if (consumeLatest(sessionID, owner)) void result.session.jumpToLatest(sessionID, { force: true })
          }
        },
        async jumpToLatest(sessionID: string, opts?: { force?: boolean }) {
          const page = store.message_page[sessionID]
          if (page?.loading) {
            if (opts?.force) queueLatest(sessionID)
            return
          }
          if (!opts?.force && !page?.hasNewer) return
          if (loadingGuard.has(sessionID)) {
            if (opts?.force) queueLatest(sessionID)
            return
          }
          const owner = sessionOwner(sessionID)
          loadingGuard.set(sessionID, owner)
          const tracker = createHydrationTracker()
          hydratingSessions.set(sessionID, tracker)

          try {
            const session = store.session.find((s) => s.id === sessionID)
            setStore("message_page", sessionID, {
              hasOlder: page?.hasOlder ?? false,
              hasNewer: page?.hasNewer ?? false,
              loading: true,
              loadingDirection: "newer",
              oldest: page?.oldest,
              newest: page?.newest,
              olderCursor: page?.olderCursor,
              newerCursor: page?.newerCursor,
              error: undefined,
            })

            const latest = await loadLatestPage(sessionID, session?.revert)
            if (staleSession(sessionID, owner)) return
            const currentMessages = store.message[sessionID] ?? []
            if (tracker.revertUpdated || hasUnmatchedAdditions(latest.items, currentMessages, tracker)) {
              queueLatest(sessionID)
              const current = store.message_page[sessionID]
              if (current)
                setStore("message_page", sessionID, {
                  ...current,
                  loading: false,
                  loadingDirection: undefined,
                })
              return
            }
            const boundary = session?.revert?.messageID

            setStore(
              produce((draft) => {
                const oldMessages = draft.message[sessionID] ?? []
                const merged = mergeHydratedItems(latest.items, oldMessages, draft.part, draft.message_cursor, tracker)
                const messages = merged.map((item) => item.info)
                const boundaryIndex = boundary ? messages.findIndex((message) => message.id === boundary) : -1
                const previousUser =
                  boundaryIndex === -1
                    ? undefined
                    : messages.slice(0, boundaryIndex).findLast((message) => message.role === "user")?.id
                const preserved = new Set([boundary, previousUser].filter((id): id is string => !!id))
                const removed = evictFromStart(messages, Math.max(0, messages.length - MAX_LOADED_MESSAGES), preserved)
                const messageIDs = new Set(messages.map((message) => message.id))
                const items = merged.filter((item) => messageIDs.has(item.info.id))
                const newIds = new Set(items.map((item) => item.info.id))
                for (const msg of oldMessages) {
                  if (!newIds.has(msg.id)) {
                    delete draft.part[msg.id]
                    delete draft.message_cursor[msg.id]
                  }
                }

                draft.message[sessionID] = items.map((item) => item.info)
                for (const msg of items) {
                  draft.part[msg.info.id] = msg.parts
                  draft.message_cursor[msg.info.id] = msg.cursor
                }
                const oldest = windowOldest(messages, boundary) ?? latest.oldest
                const newest = windowNewest(messages, boundary) ?? latest.newest
                draft.message_page[sessionID] = {
                  hasOlder: latest.hasOlder || removed.length > 0,
                  hasNewer: latest.hasNewer,
                  loading: false,
                  oldest,
                  newest,
                  olderCursor:
                    removed.length > 0
                      ? (edgeCursor(draft.message_cursor, oldest) ?? latest.olderCursor)
                      : latest.olderCursor,
                  newerCursor: latest.newerCursor,
                  error: undefined,
                }
              }),
            )
            if (store.todo[sessionID] !== undefined && store.session_diff[sessionID] !== undefined)
              fullSyncedSessions.add(sessionID)
          } catch (e) {
            if (staleSession(sessionID, owner)) return
            fullSyncedSessions.delete(sessionID)
            setStore(
              produce((draft) => {
                const p = draft.message_page[sessionID]
                if (p) {
                  p.loading = false
                  p.error = paginationError(e)
                }
              }),
            )
          } finally {
            if (loadingGuard.get(sessionID) === owner) loadingGuard.delete(sessionID)
            if (hydratingSessions.get(sessionID) === tracker) hydratingSessions.delete(sessionID)
            if (consumeLatest(sessionID, owner)) void result.session.jumpToLatest(sessionID, { force: true })
          }
        },
        async jumpToOldest(sessionID: string) {
          const page = store.message_page[sessionID]
          if (page?.loading || !page?.hasOlder) return
          if (loadingGuard.has(sessionID)) return
          const owner = sessionOwner(sessionID)
          loadingGuard.set(sessionID, owner)
          const tracker = createHydrationTracker()
          hydratingSessions.set(sessionID, tracker)

          try {
            setStore("message_page", sessionID, {
              ...page,
              loading: true,
              loadingDirection: "older",
              error: undefined,
            })

            const response = await sdk.client.session.messages(
              { sessionID, oldest: "true", limit: MESSAGE_PAGE_SIZE },
              { throwOnError: false },
            )
            const oldest = await (async () => {
              if (response.response.status === 400) {
                if (!page.olderCursor) throw new Error("Older message cursor is unavailable")
                return walkOlderPages({ sessionID, cursor: page.olderCursor, items: [], terminalOnly: true })
              }
              if (response.error) throw response.error
              if (!response.response.ok) throw new Error(`Failed to load oldest messages: ${response.response.status}`)
              const items = response.data ?? []
              const info = pageInfo(response.response.headers.get("link") ?? "")
              if (!info.olderCursor) return { items, info }
              return walkOlderPages({ sessionID, cursor: info.olderCursor, items, terminalOnly: true })
            })()
            if (staleSession(sessionID, owner)) return

            const session = store.session.find((s) => s.id === sessionID)
            const revert = session?.revert
            const revertMessageID = revert?.messageID

            const messages = [...oldest.items]
            const info = oldest.info

            if (revertMessageID && !messages.some((m) => m.info.id === revertMessageID)) {
              try {
                const revertResult = await sdk.client.session.message(
                  { sessionID, messageID: revertMessageID },
                  { throwOnError: false },
                )
                if (staleSession(sessionID, owner)) return
                const boundary = boundaryFromMessageResponse(revertResult)
                if (!boundary) {
                  clearRevert(sessionID, revert)
                } else {
                  const index = messageInsert(
                    messages.map((m) => m.info),
                    boundary.info,
                  )
                  if (!index.found) messages.splice(index.index, 0, boundary)
                }
              } catch (e) {
                if (staleSession(sessionID, owner)) return
                console.error("Revert marker fetch failed during jumpToOldest", {
                  messageID: revertMessageID,
                  error: paginationError(e),
                })
                throw e
              }
            }

            if (tracker.revertUpdated) {
              const current = store.message_page[sessionID]
              if (current)
                setStore("message_page", sessionID, {
                  ...current,
                  loading: false,
                  loadingDirection: undefined,
                })
              return
            }

            setStore(
              produce((draft) => {
                const oldMessages = draft.message[sessionID] ?? []
                const merged = mergeHydratedItems(messages, oldMessages, draft.part, draft.message_cursor, tracker)
                const infos = merged.map((message) => message.info)
                const removed = evictFromEnd(infos, Math.max(0, infos.length - MAX_LOADED_MESSAGES), revertMessageID)
                const messageIDs = new Set(infos.map((message) => message.id))
                const items = merged.filter((message) => messageIDs.has(message.info.id))
                const newIds = new Set(items.map((message) => message.info.id))
                for (const msg of oldMessages) {
                  if (!newIds.has(msg.id)) {
                    delete draft.part[msg.id]
                    delete draft.message_cursor[msg.id]
                  }
                }

                draft.message[sessionID] = infos
                for (const msg of items) {
                  draft.part[msg.info.id] = msg.parts
                  draft.message_cursor[msg.info.id] = msg.cursor
                }
                const nextOldest = windowOldest(infos, revertMessageID) ?? oldest.items.at(0)?.info.id
                const nextNewest = windowNewest(infos, revertMessageID) ?? oldest.items.at(-1)?.info.id
                draft.message_page[sessionID] = {
                  hasOlder: info.hasOlder,
                  hasNewer: info.hasNewer || removed.length > 0,
                  loading: false,
                  oldest: nextOldest,
                  newest: nextNewest,
                  olderCursor: info.olderCursor,
                  newerCursor:
                    removed.length > 0
                      ? (edgeCursor(draft.message_cursor, nextNewest) ?? info.newerCursor)
                      : info.newerCursor,
                  error: undefined,
                }
              }),
            )
          } catch (e) {
            if (staleSession(sessionID, owner)) return
            setStore(
              produce((draft) => {
                const p = draft.message_page[sessionID]
                if (p) {
                  p.loading = false
                  p.error = paginationError(e)
                }
              }),
            )
          } finally {
            if (loadingGuard.get(sessionID) === owner) loadingGuard.delete(sessionID)
            if (hydratingSessions.get(sessionID) === tracker) hydratingSessions.delete(sessionID)
            if (consumeLatest(sessionID, owner)) void result.session.jumpToLatest(sessionID, { force: true })
          }
        },
      },
      bootstrap,
    }
    return result
  },
})
