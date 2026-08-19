export * as ConfigReload from "./reload"

import { EventV2 } from "@opencode-ai/core/event"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Context, Effect, Layer, Schema } from "effect"
import { EventV2Bridge } from "@/event-v2-bridge"
import { InstanceState } from "@/effect/instance-state"
import { InstanceStore } from "@/project/instance-store"
import { SessionID } from "@/session/schema"
import { SessionPrompt } from "@/session/prompt"

export const Event = {
  Pending: EventV2.define({
    type: "config.reload.pending",
    schema: {
      pending: Schema.Boolean,
    },
  }),
  Executing: EventV2.define({
    type: "config.reload.executing",
    schema: {
      executing: Schema.Boolean,
      bootstrapCycle: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
    },
  }),
  Done: EventV2.define({
    type: "config.reload.done",
    schema: {
      sessionID: Schema.optional(Schema.String),
    },
  }),
}

export type RequestResult = {
  immediate: boolean
  input: InstanceStore.LoadInput
  bootstrapCycle?: number
  resumeSessionID?: string
}

export type Status = {
  pending: boolean
  executing: boolean
  bootstrapCycle?: number
}

export type LocationInput = {
  directory: string
  workspaceID?: string
}

export type ResumeFn = (sessionID: string) => Effect.Effect<void>

export interface Interface {
  readonly isPending: () => Effect.Effect<boolean>
  readonly start: (sessionID: string) => Effect.Effect<void>
  readonly finish: (sessionID: string) => Effect.Effect<void>
  readonly getBootstrapCycle: () => Effect.Effect<number>
  readonly status: () => Effect.Effect<Status>
  readonly statusForLocation: (input: LocationInput) => Effect.Effect<Status>
  readonly releaseBlocker: (blockerID: string) => Effect.Effect<void>
  readonly completeBootstrap: (cycle: number) => Effect.Effect<boolean>
  readonly completeBootstrapForLocation: (input: LocationInput & { cycle: number }) => Effect.Effect<boolean>
  readonly request: (sessionID?: string) => Effect.Effect<RequestResult>
  readonly check: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ConfigReload") {}

type State = {
  pending: boolean
  reloadInFlight: boolean
  reloadInput?: InstanceStore.LoadInput
  resumeSessionID?: string
  bootstrapCycle: number
  active: Set<string>
  blockers: Set<string>
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const prompt = yield* SessionPrompt.Service
    const events = yield* EventV2Bridge.Service
    const store = yield* InstanceStore.Service
    const states = new Map<string, State>()

    const resume: ResumeFn = (sessionID) =>
      prompt.loop({ sessionID: SessionID.make(sessionID) }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("config reload auto-resume failed", { sessionID, cause: String(cause) }),
        ),
        Effect.asVoid,
      )

    const isPending = Effect.fn("ConfigReload.isPending")(function* () {
      return [...states.values()].some((state) => state.pending)
    })

    const start = Effect.fn("ConfigReload.start")(function* (sessionID: string) {
      const state = yield* currentState(states)
      state.active.add(sessionID)
      yield* Effect.logDebug("config reload waiting for all sessions to finish", { sessionID })
    })

    const finish = Effect.fn("ConfigReload.finish")(function* (sessionID: string) {
      const state = yield* currentState(states)
      state.active.delete(sessionID)
      yield* Effect.logDebug("config reload session finished current turn", { sessionID })
      yield* continueOrDone(state, store, events, resume)
    })

    const getBootstrapCycle = Effect.fn("ConfigReload.getBootstrapCycle")(function* () {
      return (yield* currentState(states)).bootstrapCycle
    })

    const status = Effect.fn("ConfigReload.status")(function* () {
      return stateStatus(yield* currentState(states))
    })

    const statusForLocation = Effect.fn("ConfigReload.statusForLocation")(function* (input: LocationInput) {
      const state = findStateForLocation(states, input)
      if (!state) return { pending: false, executing: false } satisfies Status
      return stateStatus(state)
    })

    const releaseBlocker = Effect.fn("ConfigReload.releaseBlocker")(function* (blockerID: string) {
      const state = yield* currentState(states)
      state.blockers.delete(blockerID)
      yield* Effect.logDebug("config reload blocker released", { blockerID })
      yield* continueOrDone(state, store, events, resume)
    })

    const completeBootstrap = Effect.fn("ConfigReload.completeBootstrap")(function* (cycle: number) {
      const current = yield* currentInput()
      const state = findStateForCycle(states, current, cycle)
      if (!state) return false
      state.blockers.delete("tui-bootstrap")
      yield* Effect.logDebug("config reload bootstrap completed", { cycle })
      yield* continueOrDone(state, store, events, resume)
      return true
    })

    const completeBootstrapForLocation = Effect.fn("ConfigReload.completeBootstrapForLocation")(function* (
      input: LocationInput & { cycle: number },
    ) {
      const state = findStateForLocation(states, input, input.cycle)
      if (!state) return false
      state.blockers.delete("tui-bootstrap")
      yield* Effect.logDebug("config reload bootstrap completed", { cycle: input.cycle })
      yield* continueOrDone(state, store, events, resume)
      return true
    })

    const request = Effect.fn("ConfigReload.request")(function* (sessionID?: string) {
      const current = yield* currentInput()
      const state = getState(states, current.key)
      state.reloadInput = current.input
      if (sessionID) state.resumeSessionID = sessionID
      if (isBlocked(state)) {
        state.pending = true
        yield* Effect.logInfo("config reload queued", { sessionID })
        yield* publish(events, Event.Pending, { pending: true })
        return { immediate: false, input: current.input, resumeSessionID: sessionID } satisfies RequestResult
      }
      yield* Effect.logInfo("config reload executing immediately", { sessionID })
      const execution = yield* prepareExecution(state, current.input, events)
      return {
        immediate: true,
        input: current.input,
        bootstrapCycle: execution.bootstrapCycle,
        resumeSessionID: sessionID,
      } satisfies RequestResult
    })

    const check = Effect.fn("ConfigReload.check")(function* () {
      const current = yield* currentInput()
      const state = getState(states, current.key)
      if (!state.pending) return
      if (isBlocked(state)) {
        yield* Effect.logDebug("config reload waiting for sessions and blockers to finish", {
          active: [...state.active],
          blockers: [...state.blockers],
        })
        return
      }
      yield* Effect.logInfo("config reload executing deferred request")
      yield* executePending(state, current.input, store, events, resume)
    })

    return Service.of({
      isPending,
      start,
      finish,
      getBootstrapCycle,
      status,
      statusForLocation,
      releaseBlocker,
      completeBootstrap,
      completeBootstrapForLocation,
      request,
      check,
    })
  }),
)

function isBlocked(state: State) {
  return state.active.size > 0 || state.blockers.size > 0
}

function currentInput() {
  return Effect.gen(function* () {
    const ctx = yield* InstanceState.context
    const workspaceID = yield* InstanceState.workspaceID
    return {
      key: `${ctx.directory}\0${ctx.worktree}\0${workspaceID ?? ""}`,
      input: {
        directory: ctx.directory,
        worktree: ctx.worktree,
        project: ctx.project,
      },
    }
  })
}

function currentState(states: Map<string, State>) {
  return Effect.map(currentInput(), (current) => getState(states, current.key))
}

function getState(states: Map<string, State>, key: string) {
  const existing = states.get(key)
  if (existing) return existing
  const state: State = {
    pending: false,
    reloadInFlight: false,
    bootstrapCycle: 0,
    active: new Set(),
    blockers: new Set(),
  }
  states.set(key, state)
  return state
}

function findStateForCycle(states: Map<string, State>, current: { key: string; input: InstanceStore.LoadInput }, cycle: number) {
  const exact = states.get(current.key)
  if (exact?.bootstrapCycle === cycle) return exact
  const locationPrefix = `${current.input.directory}\0${current.input.worktree}\0`
  return [...states.entries()].find(([key, state]) => key.startsWith(locationPrefix) && state.bootstrapCycle === cycle)?.[1]
}

function findStateForLocation(states: Map<string, State>, input: LocationInput, cycle?: number) {
  const locationPrefix = `${input.directory}\0`
  const workspaceSuffix = input.workspaceID ? `\0${input.workspaceID}` : undefined
  return [...states.entries()].find(([key, state]) => {
    if (!key.startsWith(locationPrefix)) return false
    if (workspaceSuffix && !key.endsWith(workspaceSuffix)) return false
    if (cycle !== undefined) return state.bootstrapCycle === cycle
    return true
  })?.[1]
}

function stateStatus(state: State) {
  return {
    pending: state.pending,
    executing: state.reloadInFlight,
    bootstrapCycle: state.bootstrapCycle > 0 ? state.bootstrapCycle : undefined,
  } satisfies Status
}

function startBlocker(state: State, blockerID: string) {
  state.blockers.add(blockerID)
  if (blockerID === "tui-bootstrap") state.bootstrapCycle++
}

function prepareExecution(state: State, input: InstanceStore.LoadInput, events: EventV2.Interface) {
  return Effect.gen(function* () {
    state.pending = false
    state.active.clear()
    state.blockers.clear()
    startBlocker(state, "tui-bootstrap")
    state.reloadInFlight = true
    state.reloadInput = input
    yield* publish(events, Event.Pending, { pending: false })
    yield* publish(events, Event.Executing, { executing: true, bootstrapCycle: state.bootstrapCycle })
    return { input, bootstrapCycle: state.bootstrapCycle }
  })
}

function executePending(
  state: State,
  fallbackInput: InstanceStore.LoadInput,
  store: InstanceStore.Interface,
  events: EventV2.Interface,
  _resume: ResumeFn,
) {
  return Effect.gen(function* () {
    const execution = yield* prepareExecution(state, state.reloadInput ?? fallbackInput, events)
    yield* store.reload(execution.input).pipe(
      Effect.catchCause((cause) =>
        Effect.logError("config reload store.reload failed", { cause: String(cause) }),
      ),
    )
  })
}

function continueOrDone(
  state: State,
  store: InstanceStore.Interface,
  events: EventV2.Interface,
  resume: ResumeFn,
) {
  return Effect.gen(function* () {
    if (isBlocked(state)) return
    if (state.pending) {
      if (!state.reloadInput) return
      yield* Effect.logInfo("config reload executing deferred request")
      yield* executePending(state, state.reloadInput, store, events, resume)
      return
    }
    if (!state.reloadInFlight) return
    state.reloadInFlight = false
    yield* Effect.logInfo("config reload completed")
    yield* publish(events, Event.Done, { sessionID: state.resumeSessionID })
    if (state.resumeSessionID) {
      yield* Effect.logInfo("config reload auto-resuming session", { sessionID: state.resumeSessionID })
      yield* resume(state.resumeSessionID)
    }
  })
}

function publish<Definition extends EventV2.Definition>(
  events: EventV2.Interface,
  definition: Definition,
  data: EventV2.Data<Definition>,
) {
  return events.publish(definition, data).pipe(Effect.asVoid)
}

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [EventV2Bridge.node, InstanceStore.node, SessionPrompt.node],
})
