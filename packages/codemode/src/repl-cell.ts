import type { Program } from "acorn"
import { Effect } from "effect"
import type { Diagnostic } from "./codemode.js"
import type { OpenCell } from "./interpreter/execute.js"
import { type Interpreter, topLevelDeclarations } from "./interpreter/interpreter.js"
import {
  changedIntrinsics,
  decode,
  encode,
  type Intrinsics,
  intrinsics,
  Sources,
  StateTooLarge,
  type State,
} from "./interpreter/snapshot.js"
import type { Repl } from "./repl.js"

const MAX_LOST_WARNINGS = 10

/**
 * Runs each cell against the store's head: restores it into the cell's fresh runtime, and once the cell succeeds,
 * commits what changed. A failed cell commits nothing, so the next cell starts from the same head.
 */
export const openCell =
  <R>(store: Repl.Store, maxStateBytes: number, stable: ReadonlySet<string>): OpenCell<R> =>
  (ctx, program, code) =>
    Effect.gen(function* () {
      const table = intrinsics(ctx, stable)
      const head = yield* store.head()
      const state = head === undefined ? empty() : yield* restore(store, head, ctx, table)
      state.sources.add(code, program)
      const cell = (head?.cell ?? 0) + 1
      return {
        scope: state.scope,
        save: save(store, ctx, table, state, head, cell, program, maxStateBytes).pipe(
          Effect.catch((error) => Effect.succeed([notSaved(`the store failed to save it: ${describe(error)}`)])),
        ),
      }
    })

const empty = (): State => ({
  scope: new Map(),
  meta: new Map(),
  ids: new Map(),
  stored: new Map(),
  sources: new Sources(),
  nextId: 0,
})

const restore = <R>(store: Repl.Store, head: Repl.Commit, ctx: Interpreter<R>, table: Intrinsics) =>
  Effect.gen(function* () {
    if (head.format !== 1) return yield* Effect.fail(new Error(`format ${head.format} is not supported.`))
    // Breadth-first by reference, one read per level, so a store can serve exactly what is reachable.
    const records = new Map<number, string>()
    for (let frontier = [head.root]; frontier.length > 0; ) {
      const next = new Set<number>()
      for (const record of yield* store.read(head.id, frontier)) {
        records.set(record.id, record.data)
        for (const ref of record.refs) next.add(ref)
      }
      frontier = [...next].filter((id) => !records.has(id))
    }
    return yield* Effect.try({
      try: () => decode(ctx, table, records, head.root, head.nextId),
      catch: (error) => error,
    })
  }).pipe(
    Effect.mapError(
      (error) => new Error(`REPL state could not be restored from commit ${head.id}: ${describe(error)}`),
    ),
  )

const save = <R>(
  store: Repl.Store,
  ctx: Interpreter<R>,
  table: Intrinsics,
  state: State,
  head: Repl.Commit | undefined,
  cell: number,
  program: Program,
  maxStateBytes: number,
) =>
  Effect.gen(function* () {
    for (const [name, declaration] of topLevelDeclarations(program)) state.meta.set(name, { declaration, cell })
    const changed = changedIntrinsics(table)
    const builtins: Array<Diagnostic> =
      changed.length === 0
        ? []
        : [
            {
              kind: "StateNotSaved",
              message: `Changes to built-ins (${changed.slice(0, 5).join(", ")}${changed.length > 5 ? ", ..." : ""}) are not kept between REPL cells; put your own functions and data in top-level bindings instead.`,
            },
          ]
    const encoded = encode(ctx, table, state, cell, maxStateBytes)
    if (encoded instanceof StateTooLarge) {
      return [
        ...builtins,
        notSaved(
          `the state passed the ${maxStateBytes}-byte limit while saving \`${encoded.name}\`. Shrink or drop \`${encoded.name}\` or other large values you no longer need`,
        ),
      ]
    }
    const committed = yield* store.write(
      {
        id: crypto.randomUUID(),
        parent: head?.id,
        cell,
        root: encoded.root,
        nextId: state.nextId,
        bytes: encoded.bytes,
        bindings: encoded.bindings,
        format: 1,
      },
      encoded.records,
    )
    if (!committed) return [...builtins, notSaved("another cell committed to this REPL context first")]
    const lost = encoded.lost.map((message): Diagnostic => ({ kind: "StateNotSaved", message }))
    return [
      ...builtins,
      ...lost.slice(0, MAX_LOST_WARNINGS),
      ...(lost.length > MAX_LOST_WARNINGS
        ? [
            {
              kind: "StateNotSaved",
              message: `${lost.length - MAX_LOST_WARNINGS} more values could not be saved.`,
            } satisfies Diagnostic,
          ]
        : []),
    ]
  })

const notSaved = (reason: string): Diagnostic => ({
  kind: "StateNotSaved",
  message: `This cell's REPL state was not saved: ${reason}. Later cells see the state from before this cell.`,
})

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error))
