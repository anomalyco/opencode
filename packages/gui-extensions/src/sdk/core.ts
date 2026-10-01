import type { Schema } from "effect"
import type { Accessor } from "solid-js"

export type Cleanup = () => void | Promise<void>
export type OS = "macos" | "windows" | "linux"
export type Params = Record<string, string | number | boolean>
export type Messages = Readonly<Record<string, string>>

/** English ships inline; other locales load when the user picks them. */
export type Catalog = { readonly en: Messages } & {
  readonly [locale: string]: Messages | (() => Promise<{ readonly default: Messages }>)
}

export type Setup = (ctx: Context) => void | Cleanup | Promise<void | Cleanup>

export interface Definition {
  /** Prefix of every id the extension creates: commands, panels, settings, storage, services, points. */
  readonly id: string
  readonly os?: readonly OS[]
  readonly i18n?: Catalog
  readonly renderer?: () => Promise<{ readonly default: Setup }>
  readonly main?: () => Promise<{ readonly default: Setup }>
}

export const Extension = {
  define: (definition: Definition) => definition,
}

declare const brand: unique symbol

/** A named place that accepts contributions. The owner of the point decides how to render its items. */
export interface Point<T> {
  readonly kind: "point"
  readonly id: string
  readonly [brand]?: T
}

/** An in-process contract. Any interface, no schema, never crosses IPC. */
export interface Service<T> {
  readonly kind: "service"
  readonly id: string
  readonly [brand]?: T
}

/** A capability the host always provides. */
export interface Host<T> {
  readonly kind: "host"
  readonly id: string
  readonly [brand]?: T
}

type Codec = Schema.ConstraintCodec<unknown, unknown>
export interface RemoteMethod {
  readonly input?: Codec
  readonly output?: Codec
}
export interface RemoteSpec {
  readonly id: string
  readonly state?: Codec
  readonly methods: Readonly<Record<string, RemoteMethod>>
  readonly events?: Readonly<Record<string, Codec>>
}

/** A contract provided in the main process and used from the renderer over the IPC bridge. */
export interface Remote<S extends RemoteSpec = RemoteSpec> {
  readonly kind: "remote"
  readonly id: string
  readonly spec: S
}

type TypeOf<C> = C extends Codec ? C["Type"] : void

/** What the renderer gets from `use(remote)`. Methods are async; state is synced per window. */
export type RemoteClient<S extends RemoteSpec> = {
  readonly [Name in keyof S["methods"]]: (
    input: TypeOf<S["methods"][Name]["input"]>,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<TypeOf<S["methods"][Name]["output"]>>
} & {
  state(): TypeOf<S["state"]> | undefined
  on<Name extends keyof NonNullable<S["events"]> & string>(
    name: Name,
    listener: (data: TypeOf<NonNullable<S["events"]>[Name]>) => void,
  ): Cleanup
}

/** Identifies the renderer window a remote call came from. Main uses it to scope state and events. */
export interface Caller {
  readonly window: number
  readonly signal: AbortSignal
}

/** What main passes to `provide(remote, impl)`. */
export type RemoteImpl<S extends RemoteSpec> = {
  readonly [Name in keyof S["methods"]]: (
    input: TypeOf<S["methods"][Name]["input"]>,
    caller: Caller,
  ) => TypeOf<S["methods"][Name]["output"]> | Promise<TypeOf<S["methods"][Name]["output"]>>
} & (S["state"] extends Codec ? { state(window: number): TypeOf<S["state"]> } : unknown)

/** Returned by `provide(remote, impl)` in main. */
export interface Provided<S extends RemoteSpec> {
  /** Re-reads `impl.state` and sends it to one window, or to every window. */
  changed(window?: number): void
  emit<Name extends keyof NonNullable<S["events"]> & string>(
    name: Name,
    data: TypeOf<NonNullable<S["events"]>[Name]>,
    window?: number,
  ): void
  dispose(): void
}

export interface Context {
  readonly id: string
  /** Aborts when the extension is disabled, reloaded, or the window closes. */
  readonly signal: AbortSignal
  /** Runs when the extension goes away; runs at once if it already has, e.g. after an await in setup. */
  cleanup(fn: Cleanup): Cleanup
  /** Contribute an item. Pass a function to contribute reactively; return undefined to withdraw. */
  add<T>(point: Point<T>, item: T | (() => T | undefined)): Cleanup
  /** Read contributions to a point this extension owns. Reactive. */
  list<T>(point: Point<T>): readonly T[]
  provide<T>(token: Service<T>, impl: T): Cleanup
  provide<S extends RemoteSpec>(token: Remote<S>, impl: RemoteImpl<S>): Provided<S>
  use<T>(token: Host<T>): T
  /** Follows the provider live: undefined until it exists, and again after it goes away. */
  use<T>(token: Service<T>): Accessor<T | undefined>
  use<S extends RemoteSpec>(token: Remote<S>): Accessor<RemoteClient<S> | undefined>
  /** Resolves this extension's catalog, then the app's shared keys. */
  t(key: string, params?: Params): string
  plural(key: string, count: number, params?: Params): string
}

export const Point = {
  define: <T>(id: string): Point<T> => ({ kind: "point", id }),
}

export const Service = {
  define: <T>(id: string): Service<T> => ({ kind: "service", id }),
}

export const Host = {
  define: <T>(id: string): Host<T> => ({ kind: "host", id }),
}

export const Remote = {
  define: <const S extends RemoteSpec>(spec: S): Remote<S> => ({ kind: "remote", id: spec.id, spec }),
}
