export namespace State {
  interface Entry {
    state: any
    dispose?: (state: any) => Promise<void>
  }

  const entries = new Map<string, Map<any, Entry>>()

  export function create<S>(root: () => string, init: () => S, dispose?: (state: Awaited<S>) => Promise<void>) {
    return () => {
      const key = root()
      let collection = entries.get(key)
      if (!collection) {
        collection = new Map<string, Entry>()
        entries.set(key, collection)
      }
      const exists = collection.get(init)
      if (exists) return exists.state as S
      const state = init()
      collection.set(init, {
        state,
        dispose,
      })
      return state
    }
  }

  export async function dispose(key: string) {
    for (const [_, entry] of entries.get(key)?.entries() ?? []) {
      if (!entry.dispose) continue
      await entry.dispose(await entry.state)
    }
  }
}
