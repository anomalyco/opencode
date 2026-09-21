import { createEffect, createMemo, createSignal, onCleanup, type Accessor, type JSX, type ParentProps } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { ExecutionRpc } from "@bearmanser/opencode-superpowers-execution/contract"
import type { SessionModel } from "@/session/model"
import { SESSION_EXECUTION_TAB } from "@/shell/state/session-tabs"
import { sessionHref } from "@/shell/routes/session"
import { useServer } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { createSessionExecution } from "./bridge-client"
import { requestEvidenceReveal } from "./evidence-reveal"
import { createExecutionScope, scopeKey } from "./identity"
import {
  createNativeBoundary,
  createNativeExecutionAdapter,
  messageHasPart,
  nativeState,
  type NativeExecutionAdapter,
  type NativeScope,
  type NativeSnapshot,
  type NativeTarget,
} from "./native-adapter"
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
  const scope = createMemo<NativeScope | undefined>(() => {
    const root = rootSessionID()
    const info = root ? input.session.shared.data.session.get(root) : undefined
    const scoped = createExecutionScope({
      serverKey: server.key,
      ownerDirectory: info?.location.directory ?? input.session.workspace.directory(),
      rootSessionID: root,
    })
    if (!scoped) return undefined
    return { serverKey: server.key, ownerDirectory: scoped.ownerDirectory, rootSessionID: scoped.rootSessionID }
  })
  const [nativeSnapshot, setNativeSnapshot] = createSignal<NativeSnapshot | undefined>()
  let nativeAdapter: NativeExecutionAdapter | undefined
  let nativeAdapterKey: string | undefined
  const hydrateNative = () => {
    const current = scope()
    const selected = input.session.identity.sessionID()
    if (!current || !selected) {
      nativeAdapter?.dispose()
      nativeAdapter = undefined
      nativeAdapterKey = undefined
      setNativeSnapshot(undefined)
      return
    }
    const key = `${scopeKey(current)}::${selected}`
    if (key !== nativeAdapterKey) {
      nativeAdapter?.dispose()
      nativeAdapter = createNativeExecutionAdapter({
        target: (): NativeTarget => ({ scope: current, selectedSessionID: selected }),
        boundary: createNativeBoundary({ api: sdk.api }),
      })
      nativeAdapterKey = key
      setNativeSnapshot(undefined)
    }
    const adapter = nativeAdapter
    if (!adapter) return
    void adapter.hydrate().then(
      (snapshot) => setNativeSnapshot(snapshot),
      () => setNativeSnapshot(undefined),
    )
  }
  const agents = createMemo<ExecutionAgent[]>(() =>
    (nativeSnapshot()?.nodes ?? []).map((record) => ({ ...record, state: nativeState(record) })),
  )
  hydrateNative()
  createEffect(() => {
    input.session.identity.sessionID()
    scope()
    hydrateNative()
  })
  onCleanup(() => nativeAdapter?.dispose())
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
    navigateEvidence,
    agents: () => agents(),
    retry: hydrateNative,
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
