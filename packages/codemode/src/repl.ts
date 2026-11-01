export * as Repl from "./repl.js"

import { Effect } from "effect"
import type { Declaration } from "./interpreter/interpreter.js"

/** How a host turns on REPL mode; see `CodeMode.Options.repl`. */
export type Options = {
  /** Where each cell's state is committed. Defaults to a new `Repl.memory()` store owned by the runtime. */
  readonly store?: Store
  /**
   * Most UTF-8 bytes the saved state may take, counted over every record reachable from the top-level bindings. A
   * cell whose state would exceed it still returns its result, but its changes are not saved. Defaults to 16 MiB.
   */
  readonly maxStateBytes?: number
}

export const DEFAULT_MAX_STATE_BYTES = 16 * 1024 * 1024

/** One saved cell. Each successful cell commits once, on top of the commit it started from. */
export type Commit = {
  /** Unique id chosen by the runtime. */
  readonly id: string
  /** The commit this cell started from; undefined for the first cell. */
  readonly parent: string | undefined
  /** 1-based count of committed cells, which error messages and the inventory refer to. */
  readonly cell: number
  /** Record id of the top-level scope. */
  readonly root: number
  /** Next unused record id; record ids are never reused. */
  readonly nextId: number
  /** Total UTF-8 bytes of the records reachable from `root`. */
  readonly bytes: number
  /** The top-level bindings after this cell, for showing the model what exists. */
  readonly bindings: ReadonlyArray<Binding>
  /** Record format version. */
  readonly format: 1
}

/**
 * One saved object, scope, or cell source. `id` is stable for the object's lifetime, so a commit carries only the
 * records that are new or whose `data` changed; any record not in a commit is the one visible at its parent.
 */
export type Record = {
  readonly id: number
  /** Opaque JSON text; hosts store it as is. */
  readonly data: string
  /** Record ids this record refers to, for loading or collecting by reachability without reading `data`. */
  readonly refs: ReadonlyArray<number>
}

/** A top-level binding as the inventory describes it. */
export type Binding = {
  readonly name: string
  readonly declaration: Declaration
  /** The cell that last declared it. */
  readonly cell: number
  /** `typeof`-like: "string", "number", "object", "array", "function", "tool", "lost", or a built-in tag such as "Map". */
  readonly kind: string
  /** A short rendering, at most 100 characters. */
  readonly preview: string
  /** UTF-8 bytes of the records first reached through this binding; shared objects count once. */
  readonly bytes: number
  /** Why the value could not be saved; reading the binding throws this message. */
  readonly lost?: string
}

/**
 * Where a REPL context keeps its commits. One store is one context: cells run one at a time against its head. Every
 * method may fail; a failed read fails the cell, a failed write leaves the cell unsaved with a warning.
 */
export type Store = {
  /** The latest commit, or undefined before the first cell is saved. */
  readonly head: () => Effect.Effect<Commit | undefined, unknown>
  /** The records with these ids as visible at `commit`, in any order; ids that do not exist are omitted. */
  readonly read: (commit: string, ids: ReadonlyArray<number>) => Effect.Effect<ReadonlyArray<Record>, unknown>
  /**
   * Atomically stores the commit and its new or changed records and makes it the head, but only while the head is
   * still `commit.parent`. Returns false, storing nothing, when another cell committed first.
   */
  readonly write: (commit: Commit, records: ReadonlyArray<Record>) => Effect.Effect<boolean, unknown>
}

/** A store in process memory, which keeps every commit so a host can read earlier ones. */
export const memory = (): Store => {
  const commits = new Map<string, { readonly commit: Commit; readonly records: Map<number, Record> }>()
  let head: Commit | undefined
  // The head's full view, so reading at the head needs no walk through parents.
  let visible = new Map<number, Record>()
  const lookup = (commit: string, id: number): Record | undefined => {
    for (
      let at = commits.get(commit);
      at !== undefined;
      at = at.commit.parent ? commits.get(at.commit.parent) : undefined
    ) {
      const found = at.records.get(id)
      if (found !== undefined) return found
    }
    return undefined
  }
  return {
    head: () => Effect.sync(() => head),
    read: (commit, ids) =>
      Effect.sync(() =>
        ids.flatMap((id) => {
          const found = commit === head?.id ? visible.get(id) : lookup(commit, id)
          return found === undefined ? [] : [found]
        }),
      ),
    write: (commit, records) =>
      Effect.sync(() => {
        if (commit.parent !== head?.id) return false
        const changed = new Map(records.map((record) => [record.id, record]))
        commits.set(commit.id, { commit, records: changed })
        if (commit.parent === undefined) visible = new Map()
        for (const [id, record] of changed) visible.set(id, record)
        head = commit
        return true
      }),
  }
}

/** The top-level bindings at the store's head, for a host to show after compaction or a restart. */
export const inventory = (store: Store): Effect.Effect<ReadonlyArray<Binding>, unknown> =>
  store.head().pipe(Effect.map((commit) => commit?.bindings ?? []))
