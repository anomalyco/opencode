import { createEffect, createMemo, onCleanup, onMount, type Accessor, type JSX, type ParentProps } from "solid-js"
import { createStore } from "solid-js/store"
import { useNavigate } from "@solidjs/router"
import { ExecutionRpc } from "@bearmanser/opencode-superpowers-execution/contract"
import type { SessionModel } from "@/session/model"
import { SESSION_EXECUTION_TAB } from "@/shell/state/session-tabs"
import { sessionHref } from "@/shell/routes/session"
import { useServer } from "@/runtime/server/current"
import { useServerSDK } from "@/runtime/server/client"
import { createSessionExecution } from "./bridge-client"
import { consumeExecutionOverview, openExecutionOverview } from "./home-summary"
import { requestEvidenceReveal } from "./evidence-reveal"
import { createExecutionPreferences } from "./preferences"
import {
  createNativeBoundary,
  createNativeExecutionAdapter,
  latestNativeActivity,
  messageHasPart,
  nativeRecord,
  nativeSessionInfo,
  nativeState,
  resolveNativeTarget,
  type NativeResolvedTarget,
} from "./native-adapter"
import { createNativeExecutionOwner } from "./native-execution"
import type { NativeRecord } from "./native-types"
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
  visible?: Accessor<boolean>
  reviewRequest?: () => void
  openSession?: (sessionID: string) => void
  onOverviewRequested?: (model: ExecutionModel) => void
}): ExecutionModel {
  const server = useServer()
  const sdk = useServerSDK()
  const navigate = useNavigate()
  const boundary = createNativeBoundary({ api: sdk.api })
  const [native, setNative] = createStore<{
    target?: NativeResolvedTarget
    activity: Record<string, string | undefined>
  }>({ activity: {} })
  const scope = () => native.target?.scope
  const executionVisible = input.visible ?? (() => input.session.layout.tabs().active() === SESSION_EXECUTION_TAB)
  const connected = () => sdk.connection.status() === "connected"
  const ancestry = createMemo(() =>
    JSON.stringify(
      input.session.shared.data.session.list().map((session) => [session.id, session.parentID, session.location.directory]),
    ),
  )
  let resolutionGeneration = 0
  let resolutionController: AbortController | undefined
  let resolvedSessionID: string | undefined
  let activityGeneration = 0
  let activityActive = 0
  let activityDisposed = false
  let activityController = new AbortController()
  const activityLoaded = new Set<string>()
  const activityQueued = new Set<string>()
  const activityQueue: string[] = []

  const cancelActivity = (reset: boolean) => {
    activityGeneration += 1
    activityController.abort()
    if (!activityDisposed) activityController = new AbortController()
    activityQueued.clear()
    activityQueue.length = 0
    if (!reset) return
    activityLoaded.clear()
    setNative("activity", {})
  }

  const resolveTarget = () => {
    const selectedSessionID = input.session.identity.sessionID()
    resolutionGeneration += 1
    const current = resolutionGeneration
    resolutionController?.abort()
    const identityChanged = resolvedSessionID !== selectedSessionID
    resolvedSessionID = selectedSessionID
    if (identityChanged) {
      cancelActivity(true)
      setNative("target", undefined)
    }
    if (!selectedSessionID || !connected()) return
    const controller = new AbortController()
    resolutionController = controller
    void resolveNativeTarget({
      serverKey: server.key,
      selectedSessionID,
      boundary,
      signal: controller.signal,
    }).then((target) => {
      if (current !== resolutionGeneration || controller.signal.aborted || !target) return
      const previous = native.target
      const sameTarget =
        previous?.selectedSessionID === target.selectedSessionID &&
        previous.scope.serverKey === target.scope.serverKey &&
        previous.scope.ownerDirectory === target.scope.ownerDirectory &&
        previous.scope.rootSessionID === target.scope.rootSessionID
      if (!sameTarget) cancelActivity(true)
      setNative("target", target)
    })
  }

  createEffect(() => {
    input.session.identity.sessionID()
    ancestry()
    connected()
    resolveTarget()
  })
  const nativeExecution = createNativeExecutionOwner({
    scope,
    selectedSessionID: () => input.session.identity.sessionID(),
    createAdapter: (target) =>
      createNativeExecutionAdapter({
        target: () => ({ ...target, resolvedChain: native.target?.resolvedChain }),
        boundary,
      }),
  })
  createEffect(() => {
    native.target
    nativeExecution.refresh()
  })
  const agents = createMemo<ExecutionAgent[]>(() =>
    (nativeExecution.snapshot()?.nodes ?? []).map((record) => {
      const info = input.session.shared.data.session.get(record.id)
      const messages = input.session.shared.data.session.message.list(record.id)
      const activity = latestNativeActivity(messages) ?? native.activity[record.id] ?? record.activity
      const status: NativeRecord["status"] =
        input.session.shared.data.session.status(record.id) === "running" ? "running" : "idle"
      const permissions = input.session.shared.data.session.permission.list(record.id)
      const forms = input.session.shared.data.session.form.list(record.id)
      const pending =
        (permissions?.length ?? 0) > 0 ||
        (forms?.some(
          (form) => form.metadata?.kind === "question" || form.metadata?.kind === "websearch.provider",
        ) ??
          false)
      const needsInput = pending ? true : permissions !== undefined && forms !== undefined ? false : record.needsInput
      const live = info
        ? nativeRecord(nativeSessionInfo(info), status, needsInput)
        : { ...record, status, needsInput }
      const merged = { ...record, ...live, title: live.title || record.title, activity }
      return { ...merged, state: nativeState(merged) }
    }),
  )

  const pumpActivity = () => {
    if (activityDisposed || !executionVisible()) return
    while (activityActive < 4 && activityQueue.length > 0) {
      const sessionID = activityQueue.shift()
      if (!sessionID) continue
      const current = activityGeneration
      const signal = activityController.signal
      activityActive += 1
      void sdk.api.message
        .list({ sessionID, order: "desc", limit: 20 }, { signal })
        .then((page) => {
          if (current !== activityGeneration || activityDisposed || signal.aborted || !executionVisible()) return
          setNative("activity", sessionID, latestNativeActivity([...page.data].reverse()))
          activityLoaded.add(sessionID)
        })
        .catch(() => undefined)
        .finally(() => {
          activityActive -= 1
          if (current === activityGeneration) activityQueued.delete(sessionID)
          pumpActivity()
        })
    }
  }
  const loadAgentActivity = (sessionIDs: string[]) => {
    if (!executionVisible()) return
    sessionIDs.forEach((sessionID) => {
      if (activityLoaded.has(sessionID) || activityQueued.has(sessionID)) return
      const local = latestNativeActivity(input.session.shared.data.session.message.list(sessionID))
      if (local) {
        setNative("activity", sessionID, local)
        activityLoaded.add(sessionID)
        return
      }
      activityQueued.add(sessionID)
      activityQueue.push(sessionID)
    })
    pumpActivity()
  }
  createEffect(() => {
    if (executionVisible()) return
    cancelActivity(false)
  })
  onCleanup(() => {
    activityDisposed = true
    resolutionGeneration += 1
    resolutionController?.abort()
    cancelActivity(false)
    nativeExecution.dispose()
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
    connection: connected,
    visible: executionVisible,
    narrow: () => !input.session.isDesktop(),
    preferences: createExecutionPreferences(),
    attention: input.attention,
    reviewRequest: input.reviewRequest,
    openSession: input.openSession,
    resolveEvidence,
    navigateEvidence,
    agents: () => agents(),
    nativeComplete: () => nativeExecution.snapshot()?.complete,
    retry: () => {
      resolveTarget()
      nativeExecution.refresh()
    },
    loadAgentActivity,
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
    visible?: Accessor<boolean>
    reviewRequest?: () => void
    openSession?: (sessionID: string) => void
    onOverviewRequested?: (model: ExecutionModel) => void
    onModel: (model: ExecutionModel) => void
  }>,
) {
  const execution = createSessionExecutionModel({
    session: props.session,
    attention: props.attention,
    visible: props.visible,
    reviewRequest: props.reviewRequest,
    openSession: props.openSession,
    onOverviewRequested: props.onOverviewRequested,
  })
  createEffect(() => props.onModel(execution))
  return props.children
}

export function createExecutionOverviewOpener(input: {
  session: SessionModel
  mobile: { setTab: (tab: "execution") => void }
}) {
  return (execution: ExecutionModel, options?: { agents?: boolean }) => {
    if (options?.agents) execution.selectSubview("agents")
    if (input.session.isDesktop()) input.session.layout.view().reviewPanel.open()
    openExecutionOverview({
      execution,
      openTab: () => void input.session.layout.tabs().open(SESSION_EXECUTION_TAB),
      showMobile: () => {
        if (!input.session.isDesktop()) input.mobile.setTab("execution")
      },
    })
  }
}

export function executionPresentationVisible(input: {
  desktop: boolean
  expanded: boolean
  reviewPanelOpen: boolean
  executionTabActive: boolean
  mobileExecution: boolean
  activeOwner: boolean
  documentVisible: boolean
}) {
  if (!input.activeOwner || !input.documentVisible) return false
  if (!input.desktop) return input.mobileExecution
  return input.expanded || (input.reviewPanelOpen && input.executionTabActive)
}

export function SessionExecutionOwner(
  props: ParentProps<{
    session: SessionModel
    attention: Accessor<ExecutionAttention>
    visible?: Accessor<boolean>
    reviewRequest?: () => void
    openSession?: (sessionID: string) => void
    mobile: { setTab: (tab: "execution") => void }
    onModel: (model: ExecutionModel) => void
  }>,
) {
  const openOverview = createExecutionOverviewOpener({ session: props.session, mobile: props.mobile })
  return (
    <SessionExecutionProvider
      session={props.session}
      attention={props.attention}
      visible={props.visible}
      reviewRequest={props.reviewRequest}
      openSession={props.openSession}
      onOverviewRequested={openOverview}
      onModel={props.onModel}
    >
      {props.children}
    </SessionExecutionProvider>
  )
}
