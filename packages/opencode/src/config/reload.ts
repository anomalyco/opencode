export * as ConfigReload from "./reload"

import { EventV2 } from "@opencode-ai/core/event"
import { Effect, Schema } from "effect"
import { EventV2Bridge } from "@/event-v2-bridge"
import { InstanceState } from "@/effect/instance-state"
import { InstanceStore } from "@/project/instance-store"

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
      bootstrapCycle: Schema.optional(Schema.Number),
    },
  }),
  Done: EventV2.define({
    type: "config.reload.done",
    schema: {},
  }),
}

export type RequestResult = {
  immediate: boolean
  input: InstanceStore.LoadInput
}

type State = {
  pending: boolean
  reloadInFlight: boolean
  reloadInput?: InstanceStore.LoadInput
  bootstrapCycle: number
  active: Set<string>
  blockers: Set<string>
}

const states = new Map<string, State>()

export function isPending() {
  return [...states.values()].some((state) => state.pending)
}

export const start = Effect.fn("ConfigReload.start")(function* (sessionID: string) {
  const state = yield* currentState()
  state.active.add(sessionID)
  yield* Effect.logDebug("config reload waiting for all sessions to finish", { sessionID })
})

export const finish = Effect.fn("ConfigReload.finish")(function* (sessionID: string) {
  const state = yield* currentState()
  state.active.delete(sessionID)
  yield* Effect.logDebug("config reload session finished current turn", { sessionID })
  yield* continueOrDone(state)
})

export const getBootstrapCycle = Effect.fn("ConfigReload.getBootstrapCycle")(function* () {
  return (yield* currentState()).bootstrapCycle
})

export const releaseBlocker = Effect.fn("ConfigReload.releaseBlocker")(function* (blockerID: string) {
  const state = yield* currentState()
  state.blockers.delete(blockerID)
  yield* Effect.logDebug("config reload blocker released", { blockerID })
  yield* continueOrDone(state)
})

export const request = Effect.fn("ConfigReload.request")(function* () {
  const current = yield* currentInput()
  const state = getState(current.key)
  state.reloadInput = current.input
  if (isBlocked(state)) {
    state.pending = true
    yield* Effect.logInfo("config reload queued")
    yield* publish(Event.Pending, { pending: true })
    return { immediate: false, input: current.input } satisfies RequestResult
  }
  yield* Effect.logInfo("config reload executing immediately")
  yield* prepareExecution(state, current.input)
  return { immediate: true, input: current.input } satisfies RequestResult
})

export const check = Effect.fn("ConfigReload.check")(function* () {
  const current = yield* currentInput()
  const state = getState(current.key)
  if (!state.pending) return
  if (isBlocked(state)) {
    yield* Effect.logDebug("config reload waiting for sessions and blockers to finish", {
      active: [...state.active],
      blockers: [...state.blockers],
    })
    return
  }
  yield* Effect.logInfo("config reload executing deferred request")
  const execution = yield* prepareExecution(state, state.reloadInput ?? current.input)
  // InstanceStore forks the new boot into its own scope before disposing the old
  // instance. This effect may be interrupted by disposal, so no logic follows it.
  yield* InstanceStore.Service.use((store) => store.reload(execution.input)).pipe(Effect.ignore)
})

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

function currentState() {
  return Effect.map(currentInput(), (current) => getState(current.key))
}

function getState(key: string) {
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

function startBlocker(state: State, blockerID: string) {
  state.blockers.add(blockerID)
  if (blockerID === "tui-bootstrap") state.bootstrapCycle++
}

function prepareExecution(state: State, input: InstanceStore.LoadInput) {
  return Effect.gen(function* () {
    state.pending = false
    state.active.clear()
    state.blockers.clear()
    startBlocker(state, "tui-bootstrap")
    state.reloadInFlight = true
    state.reloadInput = input
    yield* publish(Event.Pending, { pending: false })
    yield* publish(Event.Executing, { executing: true, bootstrapCycle: state.bootstrapCycle })
    return { input, bootstrapCycle: state.bootstrapCycle }
  })
}

function continueOrDone(state: State) {
  return Effect.gen(function* () {
    if (isBlocked(state)) return
    if (state.pending) {
      yield* check()
      return
    }
    if (!state.reloadInFlight) return
    state.reloadInFlight = false
    yield* Effect.logInfo("config reload completed")
    yield* publish(Event.Done, {})
  })
}

function publish<Definition extends EventV2.Definition>(definition: Definition, data: EventV2.Data<Definition>) {
  return EventV2Bridge.Service.use((events) => events.publish(definition, data)).pipe(Effect.asVoid)
}
