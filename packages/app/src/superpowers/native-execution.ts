import { createSignal, type Accessor } from "solid-js"
import { scopeKey } from "./identity"
import type { NativeExecutionAdapter, NativeScope, NativeSnapshot, NativeTarget } from "./native-adapter"

export type NativeExecutionOwnerInput = {
  scope: Accessor<NativeScope | undefined>
  selectedSessionID: Accessor<string | undefined>
  createAdapter: (target: NativeTarget) => NativeExecutionAdapter
}

export type NativeExecutionOwner = {
  snapshot: Accessor<NativeSnapshot | undefined>
  refresh: () => void
  dispose: () => void
}

export function createNativeExecutionOwner(input: NativeExecutionOwnerInput): NativeExecutionOwner {
  const [snapshot, setSnapshot] = createSignal<NativeSnapshot | undefined>()
  let adapter: NativeExecutionAdapter | undefined
  let adapterKey: string | undefined
  let generation = 0
  let disposed = false

  const release = () => {
    adapter?.dispose()
    adapter = undefined
    adapterKey = undefined
  }

  const refresh = () => {
    if (disposed) return
    generation += 1
    const requestGeneration = generation
    const current = input.scope()
    const selected = input.selectedSessionID()
    if (!current || !selected) {
      release()
      setSnapshot(undefined)
      return
    }
    const key = `${scopeKey(current)}::${selected}`
    if (key !== adapterKey) {
      release()
      adapter = input.createAdapter({ scope: current, selectedSessionID: selected })
      adapterKey = key
      setSnapshot(undefined)
    }
    const running = adapter
    if (!running) return
    void running.hydrate().then(
      (next) => {
        if (requestGeneration !== generation || disposed) return
        setSnapshot(next)
      },
      () => {
        if (requestGeneration !== generation || disposed) return
        setSnapshot(undefined)
      },
    )
  }

  const dispose = () => {
    if (disposed) return
    disposed = true
    generation += 1
    release()
  }

  return { snapshot, refresh, dispose }
}
