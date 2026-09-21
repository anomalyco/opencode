import { createEffect, createMemo, onCleanup, onMount, type Accessor, type JSX, type ParentProps } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { ExecutionRpc } from "@bearmanser/opencode-superpowers-execution/contract"
import type { SessionModel } from "@/session/model"
import { SESSION_EXECUTION_TAB } from "@/shell/state/session-tabs"
import { sessionHref } from "@/shell/routes/session"
import { useServer } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { createSessionExecution } from "./bridge-client"
import { consumeExecutionOverview } from "./home-summary"
import { requestEvidenceReveal } from "./evidence-reveal"
import { createExecutionPreferences } from "./preferences"
import { createExecutionScope } from "./identity"
import { createNativeBoundary, createNativeExecutionAdapter, messageHasPart, nativeState } from "./native-adapter"
import { createNativeExecutionOwner } from "./native-execution"
import type {
  EvidenceNavigator,
  EvidenceResolver,
  ExecutionAgent,
  ExecutionAttention,
  ExecutionModel,
} from "./model"

export function createSessionExecutionModel(input: {
  session: SessionModel
  attention: Accessor<ExecutionAttention>
  reviewRequest?: () => void
  openSession?: (sessionID: string) => void
  onOverviewRequested?: (model: ExecutionModel) => void
}): ExecutionModel {
  const server = useServer()
  const sdk = useServerSDK()
  const navigate = useNavigate()
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
  const nativeExecution = createNativeExecutionOwner({
    scope: () => {
      const current = scope()
      if (!current) return undefined
      return { serverKey: server.key, ownerDirectory: current.ownerDirectory, rootSessionID: current.rootSessionID }
    },
    selectedSessionID: () => input.session.identity.sessionID(),
    createAdapter: (target) =>
      createNativeExecutionAdapter({
        target: () => target,
        boundary: createNativeBoundary({ api: sdk.api }),
      }),
  })
  const agents = createMemo<ExecutionAgent[]>(() =>
    (nativeExecution.snapshot()?.nodes ?? []).map((record) => ({ ...record, state: nativeState(record) })),
  )
  nativeExecution.refresh()
  createEffect(() => {
    input.session.identity.sessionID()
    scope()
    nativeExecution.refresh()
  })
  onCleanup(() => nativeExecution.dispose())
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
  const navigateEvidence: EvidenceNavigator = (reference) => {
    requestEvidenceReveal({
      sessionID: reference.sessionID,
      messageID: reference.messageID,
      partID: reference.partID,
    })
    void navigate(`${sessionHref(server.key, reference.sessionID)}#message-${reference.messageID}`)
  }
  const execution = createSessionExecution({
    scope,
    api: () => sdk.api.rpc(ExecutionRpc),
    events: sdk.event,
    connection: () => sdk.connection.status() === "connected",
    visible: () => input.session.layout.tabs().active() === SESSION_EXECUTION_TAB,
    narrow: () => !input.session.isDesktop(),
    preferences: createExecutionPreferences(),
    attention: input.attention,
    reviewRequest: input.reviewRequest,
    openSession: input.openSession,
    resolveEvidence,
    navigateEvidence,
    agents: () => agents(),
    nativeComplete: () => nativeExecution.snapshot()?.complete,
    retry: nativeExecution.refresh,
  })
  onMount(() => {
    if (!consumeExecutionOverview(input.session.identity.sessionID())) return
    input.onOverviewRequested?.(execution.model)
  })
  return execution.model
}

export function SessionExecutionProvider(
  props: ParentProps<{
    session: SessionModel
    attention: Accessor<ExecutionAttention>
    reviewRequest?: () => void
    openSession?: (sessionID: string) => void
    onOverviewRequested?: (model: ExecutionModel) => void
    onModel: (model: ExecutionModel) => void
  }>,
) {
  const execution = createSessionExecutionModel({
    session: props.session,
    attention: props.attention,
    reviewRequest: props.reviewRequest,
    openSession: props.openSession,
    onOverviewRequested: props.onOverviewRequested,
  })
  createEffect(() => props.onModel(execution))
  return props.children
}
