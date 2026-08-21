import type { SessionMessageInfo, SessionMessageUser } from "@opencode-ai/client/promise"
import { createMediaQuery } from "@solid-primitives/media"
import { createMemo } from "solid-js"
import { useFile } from "@/context/file"
import { useWorkspaceLocation } from "@/context/location"
import { useData } from "@/context/server"
import { same } from "@/utils/same"
import { containsDirectory, isWorkspaceDirectory } from "@/utils/workspace"
import { createSessionTabs } from "./helpers"
import {
  normalizeSessionTab,
  normalizeSessionTabs,
  selectSessionUserMessages,
  selectVisibleSessionUserMessages,
} from "./session-domain"
import { useSessionLayout } from "./session-layout"
import { createSessionOwnership } from "./session-ownership"

const emptyMessages: SessionMessageInfo[] = []
const emptyUserMessages: SessionMessageUser[] = []
const idle = { type: "idle" as const }

export function useSessionModel() {
  const file = useFile()
  const data = useData()
  const layout = useSessionLayout()
  const location = useWorkspaceLocation()
  const isDesktop = createMediaQuery("(min-width: 768px)")
  const sessionID = createMemo(() => layout.params.id)
  const info = createMemo(() => {
    const id = sessionID()
    return id ? data.session.get(id) : undefined
  })
  const parentID = createMemo(() => info()?.parentID)
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
  const project = createMemo(() => {
    const current = info()
    const value = current?.projectID
      ? data.project.get(current.projectID)
      : data.project.list().find((item) => containsDirectory(item.canonical, location().directory))
    if (!value) return
    return { ...value, worktree: value.canonical, worktrees: [] }
  })
  const canReview = createMemo(() => !!project())
  const normalizeTab = (tab: string) => normalizeSessionTab(tab, file.tab)
  const tabs = createSessionTabs({
    tabs: layout.tabs,
    pathFromTab: file.pathFromTab,
    normalizeTab,
    review: isDesktop,
    hasReview: canReview,
    fileBrowser: () => isDesktop() && !!sessionID(),
  })

  return {
    shared: { data },
    project,
    canReview,
    isDesktop,
    workspace: {
      directory: createMemo(() => info()?.location.directory ?? location().directory),
      current: createMemo(() => isWorkspaceDirectory(project(), info()?.location.directory ?? location().directory)),
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
    },
    ownership: createSessionOwnership(layout.sessionKey),
    tabs: {
      ...tabs,
      normalize: normalizeTab,
      normalizeAll: (values: string[]) => normalizeSessionTabs(values, normalizeTab),
    },
  }
}

export type SessionModel = ReturnType<typeof useSessionModel>
