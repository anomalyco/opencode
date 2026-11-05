import type { StorageSnapshot } from "../../shared/ipc-transport"

export type StorageItems = { items: Record<string, string>; revision: number }

/** Settles a namespace's `items(name)` read. */
export type StorageItemsReply = PromiseWithResolvers<StorageItems>

export type StorageChange = {
  readonly name: string
  readonly insert: Record<string, string>
  readonly remove: string[]
  readonly revision: number
}

// The preload asks main for the namespaces the shell reads first. Each namespace's first read is served from that
// snapshot, which follows main's changes until then, so a change another window made while this one booted is not lost.
// `seeding` holds the reads and changes that arrive before the snapshot does; `ready` holds the seeds not read yet.
// `opened` is every namespace this window opened, which hears main's changes directly.
export type DesktopStorageState<Namespace> =
  | {
      readonly status: "seeding"
      readonly opened: ReadonlyMap<string, Namespace>
      readonly reads: readonly { readonly name: string; readonly reply: StorageItemsReply }[]
      readonly changes: readonly StorageChange[]
    }
  | {
      readonly status: "ready"
      readonly opened: ReadonlyMap<string, Namespace>
      readonly seeds: ReadonlyMap<string, StorageItems>
    }
  | { readonly status: "disposed"; readonly opened: ReadonlyMap<string, Namespace> }

export type DesktopStorageEvent<Namespace> =
  | { readonly type: "snapshot.settled"; readonly snapshot: StorageSnapshot }
  | { readonly type: "namespace.opened"; readonly name: string; readonly namespace: Namespace }
  | { readonly type: "items.requested"; readonly name: string; readonly reply: StorageItemsReply }
  | ({ readonly type: "store.changed" } & StorageChange)
  | { readonly type: "disposed" }

export type DesktopStorageEffect<Namespace> =
  | { readonly type: "resolve-items"; readonly reply: StorageItemsReply; readonly value: StorageItems }
  | { readonly type: "fetch-items"; readonly name: string; readonly reply: StorageItemsReply }
  | { readonly type: "reject-items"; readonly reply: StorageItemsReply }
  | ({ readonly type: "accept-remote"; readonly namespace: Namespace } & Omit<StorageChange, "name">)

export type DesktopStorageTransition<Namespace> = {
  readonly state: DesktopStorageState<Namespace>
  readonly effects: readonly DesktopStorageEffect<Namespace>[]
}

export function createDesktopStorageState<Namespace>(): DesktopStorageState<Namespace> {
  return { status: "seeding", opened: new Map(), reads: [], changes: [] }
}

export function transitionDesktopStorage<Namespace>(
  state: DesktopStorageState<Namespace>,
  event: DesktopStorageEvent<Namespace>,
): DesktopStorageTransition<Namespace> {
  if (event.type === "namespace.opened") {
    if (state.opened.get(event.name) === event.namespace) return unchanged(state)

    return { state: { ...state, opened: new Map(state.opened).set(event.name, event.namespace) }, effects: [] }
  }

  if (event.type === "disposed") {
    if (state.status === "disposed") return unchanged(state)

    return {
      state: { status: "disposed", opened: state.opened },
      effects:
        state.status === "seeding" ? state.reads.map((read) => ({ type: "reject-items", reply: read.reply })) : [],
    }
  }

  if (state.status === "disposed") {
    if (event.type !== "items.requested") return unchanged(state)

    return { state, effects: [{ type: "reject-items", reply: event.reply }] }
  }

  if (event.type === "store.changed") {
    const namespace = state.opened.get(event.name)

    const effects: DesktopStorageEffect<Namespace>[] = namespace
      ? [{ type: "accept-remote", namespace, insert: event.insert, remove: event.remove, revision: event.revision }]
      : []

    if (state.status === "seeding") return { state: { ...state, changes: [...state.changes, event] }, effects }
    const seed = state.seeds.get(event.name)

    if (!seed || event.revision <= seed.revision) return { state, effects }

    return { state: { ...state, seeds: new Map(state.seeds).set(event.name, apply(seed, event)) }, effects }
  }

  if (event.type === "items.requested") {
    if (state.status === "seeding") {
      return { state: { ...state, reads: [...state.reads, { name: event.name, reply: event.reply }] }, effects: [] }
    }

    const seed = state.seeds.get(event.name)

    if (!seed) return { state, effects: [{ type: "fetch-items", name: event.name, reply: event.reply }] }
    const seeds = new Map(state.seeds)
    seeds.delete(event.name)

    return { state: { ...state, seeds }, effects: [{ type: "resolve-items", reply: event.reply, value: seed }] }
  }

  if (state.status === "ready") return unchanged(state)

  // Changes main made after the snapshot was read are folded in; older ones are already part of it.
  const seeds = new Map(
    Object.entries(event.snapshot).map(([name, snapshot]): [string, StorageItems] => [
      name,
      state.changes.reduce(
        (seed, change) => (change.name === name && change.revision > seed.revision ? apply(seed, change) : seed),
        snapshot,
      ),
    ]),
  )

  // Reads that waited take their seed in order; a second read of the same namespace asks main.
  const effects = state.reads.map((read): DesktopStorageEffect<Namespace> => {
    const seed = seeds.get(read.name)

    if (!seed) return { type: "fetch-items", name: read.name, reply: read.reply }
    seeds.delete(read.name)

    return { type: "resolve-items", reply: read.reply, value: seed }
  })

  return { state: { status: "ready", opened: state.opened, seeds }, effects }
}

export function selectOpenedNamespace<Namespace>(state: DesktopStorageState<Namespace>, name: string) {
  return state.opened.get(name)
}

export function selectOpenedNamespaces<Namespace>(state: DesktopStorageState<Namespace>) {
  return [...state.opened.values()]
}

function apply(seed: StorageItems, change: StorageChange): StorageItems {
  const removed = new Set(change.remove)

  return {
    items: Object.fromEntries(
      Object.entries({ ...seed.items, ...change.insert }).filter((entry) => !removed.has(entry[0])),
    ),
    revision: change.revision,
  }
}

function unchanged<Namespace>(state: DesktopStorageState<Namespace>): DesktopStorageTransition<Namespace> {
  return { state, effects: [] }
}
