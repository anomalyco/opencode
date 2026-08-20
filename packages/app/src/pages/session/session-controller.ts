import type { SessionMessageInfo, SessionMessageUser } from "@opencode-ai/client/promise"
import { createMemo, type Accessor } from "solid-js"
import { useFile } from "@/context/file"
import { useData } from "@/context/server"
import { same } from "@/utils/same"
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

export function createSessionController(input: {
  review?: Accessor<boolean>
  hasReview?: Accessor<boolean>
  fileBrowser?: (sessionID: string | undefined) => boolean
}) {
  const file = useFile()
  const data = useData()
  const layout = useSessionLayout()
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
  const normalizeTab = (tab: string) => normalizeSessionTab(tab, file.tab)
  const tabs = createSessionTabs({
    tabs: layout.tabs,
    pathFromTab: file.pathFromTab,
    normalizeTab,
    review: input.review,
    hasReview: input.hasReview,
    fileBrowser: input.fileBrowser ? () => input.fileBrowser?.(sessionID()) ?? false : undefined,
  })

  return {
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

export type SessionController = ReturnType<typeof createSessionController>
