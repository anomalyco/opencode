import { Effect, Layer, ManagedRuntime } from "effect"
import * as ServiceMap from "effect/ServiceMap"
import { InstanceContext } from "./instance-context"
import { Instance } from "@/project/instance"
import * as Exit from "effect/Exit"
import * as Cause from "effect/Cause"

export const opencodeMemoMap = Layer.makeMemoMapUnsafe()

export interface ServiceRuntime<I, S, E> {
  readonly runtime: () => ManagedRuntime.ManagedRuntime<I, E>
  readonly runSync: <A, E>(f: (service: S) => Effect.Effect<A, E>) => A
  readonly runPromise: <A, E>(f: (service: S) => Effect.Effect<A, E>, options?: Effect.RunOptions) => Promise<A>
}

export const makeRuntimeGlobal = <I, S, E>(
  service: ServiceMap.Service<I, S>,
  layer: Layer.Layer<I, E>,
): ServiceRuntime<I, S, E> => {
  let runtime = globalRuntimes.get(layer) as ManagedRuntime.ManagedRuntime<I, E> | undefined
  if (!runtime) {
    runtime = ManagedRuntime.make(layer, { memoMap: opencodeMemoMap })
    globalRuntimes.set(layer, runtime)
  }
  const runSync = <A, E>(f: (service: S) => Effect.Effect<A, E>) => runtime.runSync(service.use(f))
  const runPromise = <A, E>(f: (service: S) => Effect.Effect<A, E>) => runtime.runPromise(service.use(f))
  return { runtime: () => runtime, runSync, runPromise }
}
const globalRuntimes = new Map<Layer.Layer<any, any, any>, ManagedRuntime.ManagedRuntime<any, any>>()

export const makeRuntimeInstance = <I, S, E>(
  service: ServiceMap.Service<I, S>,
  layer: Layer.Layer<I, E, InstanceContext>,
): ServiceRuntime<I, S, E> => {
  const runSync = <A, E>(f: (service: S) => Effect.Effect<A, E>) => getInstanceRuntime(layer).runSync(service.use(f))
  const runPromise = <A, E>(f: (service: S) => Effect.Effect<A, E>, options?: Effect.RunOptions) =>
    new Promise<A>((resolve, reject) => {
      const fiber = getInstanceRuntime(layer).runFork(service.use(f), options)
      fiber.addObserver((exit) => {
        if (Exit.isSuccess(exit)) {
          return resolve(exit.value)
        } else if (Cause.hasInterruptsOnly(exit.cause)) {
          return
        }
        reject(Cause.squash(exit.cause))
      })
    })
  return { runtime: () => getInstanceRuntime(layer), runSync, runPromise }
}

const allRuntimes = new Map<string, Map<Layer.Layer<any, any, any>, ManagedRuntime.ManagedRuntime<any, any>>>()

const getInstanceRuntime = <A, E>(
  layer: Layer.Layer<A, E, InstanceContext>,
): ManagedRuntime.ManagedRuntime<A | InstanceContext, E> => {
  const directory = Instance.directory

  let map = allRuntimes.get(directory)
  if (!map) {
    map = new Map()
    allRuntimes.set(directory, map)
  }

  let runtime = map.get(layer) as ManagedRuntime.ManagedRuntime<A | InstanceContext, E> | undefined
  if (!runtime) {
    runtime = ManagedRuntime.make(
      Layer.provideMerge(
        layer,
        Layer.sync(InstanceContext, () => InstanceContext.of(Instance.current)),
      ),
      { memoMap: opencodeMemoMap },
    )
    map.set(layer, runtime)
  }

  return runtime
}

export async function disposeAllRuntimes() {
  let promises: Promise<void>[] = []
  for (const runtime of globalRuntimes.values()) {
    promises.push(runtime.dispose())
  }
  globalRuntimes.clear()
  for (const map of allRuntimes.values()) {
    for (const runtime of map.values()) {
      promises.push(runtime.dispose())
    }
  }
  allRuntimes.clear()
  await Promise.all(promises)
}

export const disposeInstanceRuntimes = async (directory: string) => {
  const map = allRuntimes.get(directory)
  if (!map) return
  let promises: Promise<void>[] = []
  for (const runtime of map.values()) {
    promises.push(runtime.dispose())
  }
  allRuntimes.delete(directory)
  await Promise.all(promises)
}
