import type { SessionInfo, SessionMessageInfo, SessionMessageUser } from "@opencode/client/promise"
import { createMediaQuery } from "@solid-primitives/media"
import { createMemo } from "solid-js"
import { useWorkspaceLocation } from "@/workspaces/location"
import { useData } from "@/runtime/server/current"
import { same } from "@/runtime/persistence/equality"
import { containsDirectory } from "@opencode/util/path"
import { isProjectDirectory, isWorkspaceDirectory } from "@/workspaces/paths"
import { projectForSession } from "@/shell/layout/helpers"
import { selectSessionUserMessages, selectVisibleSessionUserMessages } from "./session-domain"
import { useSessionLayout } from "./session-layout"
import { createSessionOwnership } from "./session-ownership"
import { useTabs } from "@/shell/tabs/tabs"
import { useServer } from "@/runtime/server/current"
import type { ServerCtx } from "@/runtime/server/runtime"

const emptyMessages: SessionMessageInfo[] = []

const emptyUserMessages: SessionMessageUser[] = []

const idle = { type: "idle" as const }

export function useSessionModel() {
  const data = useData()
  const server = useServer()
  const shellTabs = useTabs()
  const layout = useSessionLayout()
  const location = useWorkspaceLocation()
  const isDesktop = createMediaQuery("(min-width: 768px)")
  const sessionID = createMemo(() => layout.params.id)

  const info = createMemo(() => {
    const id = sessionID()

    return id ? data.session.get(id) : undefined
  })

  const parentID = createMemo(() => {
    const current = info()?.parentID

    if (current) return current
    const id = sessionID()

    if (!id) return

    const tab = shellTabs.store.find(
      (item) => item.type === "session" && item.server === server.key && item.routeSessionId === id,
    )

    return tab?.type === "session" ? (tab.routeParentId ?? tab.sessionId) : undefined
  })

  const parent = createMemo(() => {
    const id = parentID()

    return id ? data.session.get(id) : undefined
  })

  const status = createMemo(() => {
    const id = sessionID()

    return id && data.session.status(id) === "running" ? { type: "busy" as const } : idle
  })

  const messages = createMemo(() => {
    const id = sessionID()

    return id ? data.session.message.list(id) : emptyMessages
  })

  const userMessages = createMemo(() => selectSessionUserMessages(messages()), emptyUserMessages, { equals: same })
  const revertMessageID = createMemo(() => info()?.revert?.messageID)

  const visibleUserMessages = createMemo(
    () => selectVisibleSessionUserMessages(userMessages(), revertMessageID()),
    emptyUserMessages,
    { equals: same },
  )

  const project = createMemo(() => sessionProject(data, info(), location().directory))

  return {
    shared: { data },
    project,
    isDesktop,
    workspace: {
      directory: createMemo(() => info()?.location.directory ?? location().directory),
      current: createMemo(() => sessionInWorkspace(server.ctx.sync.data.project, info(), location().directory)),
    },
    identity: {
      params: layout.params,
      sessionID,
      sessionKey: layout.sessionKey,
      workspaceKey: layout.workspaceKey,
    },
    data: {
      info,
      parent,
      parentID,
      isChild: createMemo(() => !!parentID()),
      status,
      working: createMemo(() => {
        const id = sessionID()

        return id ? data.session.status(id) === "running" : false
      }),
      revertMessageID,
    },
    history: {
      messages,
      userMessages,
      visibleUserMessages,
      lastUserMessage: createMemo(() => visibleUserMessages().at(-1)),
    },
    layout: {
      tabs: layout.tabs,
      view: layout.view,
      tabKey: layout.tabKey,
      sessionKey: layout.sessionKey,
    },
    ownership: createSessionOwnership(layout.sessionKey),
  }
}

export type SessionModel = ReturnType<typeof useSessionModel>

/**
 * A session's project from raw server metadata: its project id's, else the project whose root contains `directory`.
 * Global sync's enriched project replaces it once listed.
 */
export function sessionProject(data: ServerCtx["data"], info: SessionInfo | undefined, directory: string) {
  const value = info?.projectID
    ? data.project.get(info.projectID)
    : data.project.list().find((item) => containsDirectory(item.canonical, directory))

  if (!value) return

  return { ...value, worktree: value.canonical, worktrees: [] }
}

/** The session runs in a worktree or sandbox of its project rather than the project root. */
export function sessionInWorkspace(
  projects: ServerCtx["sync"]["data"]["project"],
  info: SessionInfo | undefined,
  fallback: string,
) {
  const directory = info?.location.directory ?? fallback
  // Global sync enriches projects with discovered worktrees; raw project metadata does not.
  const value = info ? projectForSession(info, projects) : projects.find((item) => isProjectDirectory(item, directory))

  return isWorkspaceDirectory(value, directory)
}
