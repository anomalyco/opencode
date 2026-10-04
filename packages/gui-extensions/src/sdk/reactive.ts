import {
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  getOwner,
  on,
  onCleanup,
  runWithOwner,
  untrack,
  type Accessor,
} from "solid-js"
import { createStore } from "solid-js/store"
import { Live } from "./core"
import { LifetimeContext, useExtension } from "./solid"

type Falsy = undefined | null | false

/**
 * What `createKeyed` and `createLatest` follow: a `Live` accessor such as `ctx.uses.name`, followed through its
 * generations, or any accessor, followed by the identity of its value.
 */
export type KeyedSource = Accessor<unknown>

/**
 * What a source gives while it is active: the provider's value for a `Live` accessor; for a plain accessor, its value,
 * which is active while it is not undefined, null or false.
 */
export type KeyedValue<S> =
  S extends Accessor<Live<infer T>> ? T : S extends Accessor<infer T> ? Exclude<T, Falsy> : never

/** One run of `createKeyed`: the source's value, or none while it is not active. */
type Run = { readonly value: unknown; readonly generation?: number } | undefined

/**
 * Runs `fn` once per key, like `<Show keyed>`: each active generation of a `Live` accessor, or each identity of a plain
 * accessor's value. Each run, and each run of `otherwise` while there is no key, has its own owner: its
 * `onCleanup` and its registrations end with it. This is the way extension code runs side effects reactively; use it
 * only to sync with something outside Solid (the DOM, a widget, an Ipc subscription), never to set state from state.
 * Call it under an owner: in setup, or in a component.
 *
 * A plain accessor that builds an object, such as `{ directory, tab }`, gives a new key each time it reads, even when
 * every field is unchanged; pass `equals` to compare the fields that matter instead.
 *
 * @param source - A `Live` accessor from `ctx.uses`, or any accessor.
 * @param fn - Runs once per key with the source's value. It runs untracked.
 * @param options - What runs while there is no key, and when a plain accessor's new value is the same key.
 *
 * @example
 * ```ts
 * // Each provider generation: listen to its events; the listener ends with the generation.
 * createKeyed(ctx.uses.updater, (updater) => void updater.on("check", () => act("check")))
 * // A plain accessor: the picker runs while the tab is visible, and `otherwise` while it is not.
 * createKeyed(visible, startPicker, { otherwise: endPicker })
 * // An object source: lists again only when the directory or the tab changes.
 * createKeyed(() => ({ directory: file.root, tab: tab() }), (key) => void list(key), {
 *   equals: (previous, next) => previous.directory === next.directory && previous.tab === next.tab,
 * })
 * ```
 */
export function createKeyed<S extends KeyedSource>(
  source: S,
  fn: (value: KeyedValue<S>) => void,
  options?: {
    /**
     * Runs while the source has no key: a `Live` accessor that is pending or inactive, or a plain accessor whose value
     * is undefined, null or false. Its own owner ends when a key arrives.
     */
    readonly otherwise?: () => void
    /**
     * Whether a plain accessor's new value is the same key as the one `fn` last ran with, so the run stays and `fn`
     * does not run again. Use it when the source builds an object each time it reads. Defaults to identity (`===`).
     * A `Live` accessor always keys by generation and ignores it.
     */
    readonly equals?: (previous: KeyedValue<S>, next: KeyedValue<S>) => boolean
  },
) {
  const read: KeyedSource = source
  const same = options?.equals

  const active = Live.is(read)
    ? createMemo<Run>(
        () => {
          const value = read()

          return value.status === "active" ? value : undefined
        },
        undefined,
        // A Live source changes generation, not merely object, when its provider restarts.
        { equals: (previous, next) => previous?.generation === next?.generation },
      )
    : createMemo<Run>(
        () => {
          const value = read()

          return value === undefined || value === null || value === false ? undefined : { value }
        },
        undefined,
        {
          equals: (previous, next) => {
            if (previous === undefined || next === undefined) return previous === next

            // SAFETY: both values come from `source` while it is active, which is what `KeyedValue<S>` describes.
            return (
              previous.value === next.value || !!same?.(previous.value as KeyedValue<S>, next.value as KeyedValue<S>)
            )
          },
        },
      )

  createRenderEffect(
    on(active, (current) => {
      // SAFETY: `current.value` comes from `source`, and `KeyedValue<S>` is what that source gives while active.
      const run = current === undefined ? options?.otherwise : () => fn(current.value as KeyedValue<S>)

      if (!run) return

      // A root per run, so a registration made through a captured owner after the run ended disposes at once.
      const lifetime = { ended: false }
      const scope = createRoot((dispose) => ({ owner: getOwner(), dispose }))

      onCleanup(() => {
        lifetime.ended = true
        scope.dispose()
      })

      if (scope.owner) scope.owner.context = { ...scope.owner.context, [LifetimeContext.id]: lifetime }
      runWithOwner(scope.owner, run)
    }),
  )
}

/**
 * The latest result of `fetch` for the source's current value. Never suspends. A new value aborts the previous request
 * through its signal and drops its reply; so does the owner going away. `latest` keeps the last result meanwhile.
 * Call it under an owner: in setup, or in a component.
 *
 * @param source - What to fetch for: a `Live` accessor from `ctx.uses`, or any accessor (see `KeyedValue`).
 * @param fetch - Fetches for one value. Pass `signal` on to the request.
 * @returns A store; read its fields in render or in a memo.
 *
 * @example
 * ```ts
 * const info = createLatest(ctx.uses.pairing, (pairing, signal) => pairing.info({ signal }))
 * const urls = () => info.latest?.urls ?? []
 * ```
 */
export function createLatest<S extends KeyedSource, T>(
  source: S,
  fetch: (value: KeyedValue<S>, signal: AbortSignal) => Promise<T>,
): {
  /** The last result; kept while a newer request runs and while the source has no value. Undefined before the first. */
  readonly latest: T | undefined
  /** A request for the current value is in flight. */
  readonly loading: boolean
  /**
   * The current request's rejection. Undefined while a request runs, after a result, and while the source has no
   * value, so it never describes an earlier value's request.
   */
  readonly error: unknown
} {
  const [state, setState] = createStore<{ latest: T | undefined; loading: boolean; error: unknown }>({
    latest: undefined,
    loading: false,
    error: undefined,
  })

  createKeyed(
    source,
    (value) => {
      const controller = new AbortController()

      onCleanup(() => controller.abort())
      setState({ loading: true, error: undefined })
      void Promise.try(() => fetch(value, controller.signal)).then(
        (latest) => {
          if (!controller.signal.aborted) setState({ latest, loading: false, error: undefined })
        },
        (cause: unknown) => {
          if (!controller.signal.aborted) setState({ loading: false, error: cause })
        },
      )
    },
    { otherwise: () => setState({ loading: false, error: undefined }) },
  )

  return state
}

/**
 * State that returns to `initial` on every routing visit of the current session (`MountedSession.visit`), e.g. a
 * selection to forget when the user goes Home and back. Call it inside a contribution or setup: it reads
 * `useExtension()`.
 *
 * @param initial - The value at the start of every visit.
 * @returns The value accessor and its setter, like `createSignal`.
 *
 * @example
 * ```ts
 * const [expanded, setExpanded] = createVisitState(false)
 * ```
 */
export function createVisitState<T>(initial: T) {
  const sessions = useExtension().sessions
  const visit = () => sessions.current()?.visit

  const [state, setState] = createSignal<{ readonly visit: object | undefined; readonly value: T }>({
    visit: undefined,
    value: initial,
  })

  const value = () => {
    const current = state()

    return current.visit !== undefined && current.visit === visit() ? current.value : initial
  }

  const set = (next: T) => void setState({ visit: untrack(visit), value: next })

  return [value, set] as const
}
