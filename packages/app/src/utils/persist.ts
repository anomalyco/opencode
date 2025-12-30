import { usePlatform } from "@/context/platform"
import { makePersisted } from "@solid-primitives/storage"
import { createResource, type Accessor } from "solid-js"
import type { SetStoreFunction, Store } from "solid-js/store"

type InitType = Promise<string> | string | null
type PersistedWithReady<T> = [Store<T>, SetStoreFunction<T>, InitType, Accessor<boolean>]

export function persisted<T>(key: string, store: [Store<T>, SetStoreFunction<T>]): PersistedWithReady<T> {
  const platform = usePlatform()
  const [state, setState, init] = makePersisted(store, { name: key, storage: platform.storage?.() ?? localStorage })

  // Create a resource that resolves when the store is initialized
  // This integrates with Suspense and provides a ready signal
  const isAsync = init instanceof Promise
  const [ready] = createResource(
    () => init,
    async (initValue) => {
      if (initValue instanceof Promise) await initValue
      return true
    },
    { initialValue: !isAsync },
  )

  return [state, setState, init, () => ready() === true]
}
