import { createEffect, createMemo, type Accessor, type JSX, type ParentProps } from "solid-js"
import { ExecutionRpc } from "@bearmanser/opencode-superpowers-execution/contract"
import type { SessionModel } from "@/session/model"
import { SESSION_EXECUTION_TAB } from "@/shell/state/session-tabs"
import { useServer } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { createSessionExecution } from "./bridge-client"
import { createExecutionScope } from "./identity"
import { messageHasPart } from "./native-adapter"
import type { EvidenceResolver, ExecutionAttention, ExecutionModel } from "./model"

export function createSessionExecutionModel(input: {
  session: SessionModel
  attention: Accessor<ExecutionAttention>
  reviewRequest?: () => void
  openSession?: (sessionID: string) => void
}): ExecutionModel {
  const server = useServer()
  const sdk = useServerSDK()
  const rootSessionID = createMemo(() => {
    const seen = new Set<string>()
    let id = input.session.identity.sessionID()
    while (id && !seen.has(id)) {
      seen.add(id)
      const parentID = input.session.shared.data.session.get(id)?.parentID
      if (!parentID) return id
      id = parentID
    }
    return id
  })
  const scope = createMemo(() => {
    const root = rootSessionID()
    const info = root ? input.session.shared.data.session.get(root) : undefined
    return createExecutionScope({
      serverKey: server.key,
      ownerDirectory: info?.location.directory ?? input.session.workspace.directory(),
      rootSessionID: root,
    })
  })
  const resolveEvidence: EvidenceResolver = async ({ sessionID, messageID, partID }) => {
    const loaded = input.session.shared.data.session.message.get(sessionID, messageID)
    if (loaded) return partID === undefined || messageHasPart(loaded, partID)
    try {
      const message = await sdk.api.session.message.get({ sessionID, messageID })
      return partID === undefined || messageHasPart(message, partID)
    } catch {
      return false
    }
  }
  return createSessionExecution({
    scope,
    api: () => sdk.api.rpc(ExecutionRpc),
    events: sdk.event,
    connection: () => sdk.connection.status() === "connected",
    visible: () => input.session.layout.tabs().active() === SESSION_EXECUTION_TAB,
    attention: input.attention,
    reviewRequest: input.reviewRequest,
    openSession: input.openSession,
    resolveEvidence,
  }).model
}

export function SessionExecutionProvider(
  props: ParentProps<{
    session: SessionModel
    attention: Accessor<ExecutionAttention>
    reviewRequest?: () => void
    openSession?: (sessionID: string) => void
    onModel: (model: ExecutionModel) => void
  }>,
) {
  const execution = createSessionExecutionModel({
    session: props.session,
    attention: props.attention,
    reviewRequest: props.reviewRequest,
    openSession: props.openSession,
  })
  createEffect(() => props.onModel(execution))
  return props.children
}
