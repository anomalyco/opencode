import type { Agent } from "@opencode/schema/agent"
import type { Model } from "@opencode/schema/model"
import type { Provider } from "@opencode/schema/provider"
import type { SessionID } from "@opencode/schema/session-id"
import type { SessionMessage } from "@opencode/schema/session-message"
import type { Data } from "@opencode/client/solid"
import type { SessionMessageUser } from "@opencode/client/promise"
import type { Accessor } from "solid-js"
import type { ModelSelection } from "@/providers/models/selection"
import type { ServerSDK } from "@/runtime/server/client"
import type { ComposerStateTarget } from "./submission-state"
import type { createComposerSubmission } from "./submission-state"

export type ComposerControls = {
  agents: {
    available: { name: string; hidden?: boolean; mode: string }[]
    options: string[]
    current: Agent.ID | ""
    visible: boolean
    select: (name: string | undefined) => void
  }
  model: {
    selection: ModelSelection
    paid: boolean
    loading: boolean
  }
}

export type ComposerSelection = {
  agent: Agent.ID
  model: { providerID: Provider.ID; modelID: Model.ID }
  variant?: Model.VariantID
}

export type ComposerDelivery = "steer" | "queue"

// Contract between the composer and the session prompt queue. The session
// owns the queue (pending inbox items); the composer only asks which delivery
// a submit should use and delegates edit confirmation while a queued prompt
// is loaded in the editor.
export type ComposerQueue = {
  count: Accessor<number>
  undoing: Accessor<boolean>
  // Delivery a plain submit uses right now.
  delivery: Accessor<ComposerDelivery>
  // Delivery offered on Mod+Enter and the toolbar hint button; undefined hides the hint.
  alternate: Accessor<ComposerDelivery | undefined>
  // Inbox ID of the queued prompt currently loaded in the composer for editing.
  editing: Accessor<string | undefined>
  confirmEdit: (delivery: ComposerDelivery) => void
  cancelEdit: () => void
  // Loads the first queued prompt into the composer. Returns false when the queue is empty.
  editFirst: () => boolean
}

export type ComposerSession = {
  id: SessionID
  directory: string
  handoff?: {
    set: (message: SessionMessageUser) => void
    clear: (messageID: SessionMessage.ID) => void
  }
  api: {
    command: (input: Parameters<ServerSDK["api"]["session"]["command"]>[0]) => Promise<unknown>
    shell: (input: Parameters<ServerSDK["api"]["session"]["shell"]>[0]) => Promise<unknown>
    switchAgent: (input: Parameters<ServerSDK["api"]["session"]["switchAgent"]>[0]) => Promise<unknown>
    switchModel: (input: Parameters<ServerSDK["api"]["session"]["switchModel"]>[0]) => Promise<unknown>
  }
  data: {
    location: { command: Pick<Data["location"]["command"], "list"> }
    session: {
      prompt: (input: Parameters<Data["session"]["prompt"]>[0]) => Promise<unknown>
      setStatus: Data["session"]["setStatus"]
    }
  }
  current: Accessor<
    { agent?: Agent.ID; model?: { id: Model.ID; providerID: Provider.ID; variant?: Model.VariantID } } | undefined
  >
  admitted: (messageID: SessionMessage.ID) => boolean
}

type ComposerAdapterBase = {
  state: ComposerStateTarget
  ready: Accessor<boolean>
  controls: Accessor<ComposerControls>
  working: Accessor<boolean>
  submitted: () => void
}

export type ActiveComposerAdapter = ComposerAdapterBase & {
  kind: "active-session"
  session: () => ComposerSession
  interrupt: () => Promise<void>
  setEditor: (element: HTMLDivElement) => void
}

export type NewSessionComposerAdapter = ComposerAdapterBase & {
  kind: "new-session"
  start: (
    selection: ComposerSelection,
    submission: ReturnType<typeof createComposerSubmission>,
    message: SessionMessageUser,
  ) => Promise<{ session: ComposerSession; cleanupReady: Promise<void>; complete?: () => Promise<void> } | undefined>
}

export type ComposerAdapter = ActiveComposerAdapter | NewSessionComposerAdapter
