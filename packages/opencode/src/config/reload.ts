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
    schema: {
      resumeSessionID: Schema.optional(Schema.String),
    },
  }),
}

export type RequestResult = {
  immediate: boolean
  input: InstanceStore.LoadInput
}

let pending = false
let resumeSessionID: string | undefined
let reloadInFlight = false
let doneResumeSessionID: string | undefined
let reloadInput: InstanceStore.LoadInput | undefined
let bootstrapCycle = 0
const active = new Set<string>()
const blockers = new Set<string>()

export function isPending() {
  return pending
}

export const start = Effect.fn("ConfigReload.start")(function* (sessionID: string) {
  active.add(sessionID)
  yield* Effect.logDebug("config reload session started", { sessionID })
})

export const finish = Effect.fn("ConfigReload.finish")(function* (sessionID: string) {
  active.delete(sessionID)
  yield* Effect.logDebug("config reload session finished", { sessionID })
  yield* doneWhenUnblocked()
})

export function getBootstrapCycle() {
  return bootstrapCycle
}

export const finishBlocker = Effect.fn("ConfigReload.finishBlocker")(function* (blockerID: string) {
  blockers.delete(blockerID)
  yield* Effect.logDebug("config reload blocker finished", { blockerID })
  yield* doneWhenUnblocked()
  if (!pending || isBlocked()) return
  yield* check()
})

export const request = Effect.fn("ConfigReload.request")(function* (options?: { resumeSessionID?: string }) {
  const input = yield* currentInput()
  reloadInput = input
  if (options?.resumeSessionID) resumeSessionID = options.resumeSessionID
  if (isBlocked()) {
    pending = true
    yield* Effect.logInfo("config reload queued", { resumeSessionID })
    yield* publish(Event.Pending, { pending: true })
    return { immediate: false, input } satisfies RequestResult
  }
  yield* Effect.logInfo("config reload executing immediately")
  yield* prepareExecution(input)
  return { immediate: true, input } satisfies RequestResult
})

export const check = Effect.fn("ConfigReload.check")(function* () {
  if (!pending) return
  if (isBlocked()) {
    yield* Effect.logDebug("config reload still blocked", { active: [...active], blockers: [...blockers] })
    return
  }
  yield* Effect.logInfo("config reload executing deferred request")
  const execution = yield* prepareExecution(reloadInput ?? (yield* currentInput()))
  // InstanceStore forks the new boot into its own scope before disposing the old
  // instance. This effect may be interrupted by disposal, so no logic follows it.
  yield* InstanceStore.Service.use((store) => store.reload(execution.input)).pipe(Effect.ignore)
})

function isBlocked() {
  return active.size > 0 || blockers.size > 0
}

function currentInput() {
  return Effect.map(InstanceState.context, (ctx) => ({
    directory: ctx.directory,
    worktree: ctx.worktree,
    project: ctx.project,
  }))
}

function startBlocker(blockerID: string) {
  blockers.add(blockerID)
  if (blockerID === "tui-bootstrap") bootstrapCycle++
}

function prepareExecution(input: InstanceStore.LoadInput) {
  return Effect.gen(function* () {
    pending = false
    const sid = resumeSessionID
    resumeSessionID = undefined
    active.clear()
    blockers.clear()
    startBlocker("tui-bootstrap")
    reloadInFlight = true
    doneResumeSessionID = sid
    reloadInput = input
    yield* publish(Event.Pending, { pending: false })
    yield* publish(Event.Executing, { executing: true, bootstrapCycle })
    return { input, resumeSessionID: sid, bootstrapCycle }
  })
}

function doneWhenUnblocked() {
  return Effect.gen(function* () {
    if (!reloadInFlight || isBlocked()) return
    reloadInFlight = false
    const sid = doneResumeSessionID
    doneResumeSessionID = undefined
    yield* Effect.logInfo("config reload completed", { resumeSessionID: sid })
    yield* publish(Event.Done, { resumeSessionID: sid })
  })
}

function publish<Definition extends EventV2.Definition>(definition: Definition, data: EventV2.Data<Definition>) {
  return EventV2Bridge.Service.use((events) => events.publish(definition, data)).pipe(Effect.asVoid)
}
