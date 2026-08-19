import { resolve } from "path"
import { FSUtil } from "./fs-util"

export interface Identity {
  readonly directory: string
}

export interface Snapshot {
  readonly identity: Identity
  readonly generation: number
  readonly runningPtys: number
}

interface State {
  generation: number
  runningPtys: number
}

const states = new Map<string, State>()
let generation = 0

/** Stable for the lifetime of an instance: absolute and lexical, without filesystem lookups. */
export function identify(directory: string): Identity {
  return { directory: resolve(FSUtil.windowsPath(directory)) }
}

const change = (identity: Identity, update?: (state: State) => void) => {
  const state = states.get(identity.directory) ?? { generation: 0, runningPtys: 0 }
  update?.(state)
  generation++
  state.generation = generation
  states.set(identity.directory, state)
}

export function touch(identity: Identity) {
  change(identity)
}

export function ptyStarted(identity: Identity) {
  change(identity, (state) => state.runningPtys++)
}

export function ptyStopped(identity: Identity) {
  const state = states.get(identity.directory)
  if (!state || state.runningPtys === 0) return
  change(identity, (current) => current.runningPtys--)
}

export function hasRunningPty(identity: Identity) {
  return (states.get(identity.directory)?.runningPtys ?? 0) > 0
}

export function snapshot(identity: Identity): Snapshot {
  const state = states.get(identity.directory)
  return {
    identity,
    generation: state?.generation ?? 0,
    runningPtys: state?.runningPtys ?? 0,
  }
}

/** Must be called in the same synchronous call stack as the guarded state transition. */
export function isCurrentAndIdle(value: Snapshot) {
  const state = states.get(value.identity.directory)
  return (state?.generation ?? 0) === value.generation && (state?.runningPtys ?? 0) === 0
}

export function forget(identity: Identity) {
  const state = states.get(identity.directory)
  if (!state || state.runningPtys > 0) return
  states.delete(identity.directory)
}

export * as InstanceActivity from "./instance-activity"
