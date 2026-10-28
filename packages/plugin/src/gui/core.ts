import type { OpenCodeClient } from "@opencode/client/promise"
import type { Schema } from "effect"

/**
 * Undoes a registration, or tears something down. Every `add` and `on` returns one, and so does a window's
 * `provide`; `onCleanup` and a setup's return value take one.
 * Calling it early withdraws at once; a second call does nothing. When the host runs it, a throw or a rejection is
 * logged and the other cleanups still run; main's `Scope` waits for a returned promise until its deadline.
 */
export type Cleanup = () => void | Promise<void>

/**
 * An operating system, as `Plugin.Declarations.os` and `Desktop.os` name it.
 * - `macos`: macOS.
 * - `windows`: Windows.
 * - `linux`: Linux and every other desktop platform.
 */
export type OS = "macos" | "windows" | "linux"

/** Values a message interpolates: `{{name}}` in a template reads `params.name`. */
export type Params = Record<string, string | number | boolean>

/** One locale's copy: message key to template. Plural keys end in a CLDR category, e.g. `files.one`, `files.other`. */
export type Messages = Readonly<Record<string, string>>

/**
 * A plugin's copy by locale, every locale inline. English fills every key a locale lacks.
 *
 * @example
 * ```ts
 * i18n: { en: { title: "Acme" }, de: { title: "Acme" } }
 * ```
 */
export type Catalog = {
  /** English, the source copy and the fallback for every key. */
  readonly en: Messages
} & {
  readonly [locale: string]: Messages
}

/** A JSON value, as plugin options in `opencode.json` hold. */
export type Json = string | number | boolean | null | readonly Json[] | { readonly [key: string]: Json }

/** A plugin's options from its `opencode.json` entry, as server and TUI plugins receive them. */
export type PluginOptions = { readonly [key: string]: Json }

/** The running app. One shape in the window and in main, with the fields server and TUI plugins get in `ctx.app`. */
export interface App {
  /** The app's name, `opencode`, as in a server plugin's `ctx.app.name`. */
  readonly name: string
  /**
   * The app version, e.g. `2.0.20`. Web and desktop windows always know it; it is `""` only in a window whose platform
   * reports none, such as a test or Storybook fixture, as no build-time version constant exists in every build.
   */
  readonly version: string
  /**
   * The release channel.
   * - `local`: a build from source, with no channel set.
   * - `dev`: the development channel.
   * - `beta`: the beta channel.
   * - `prod`: the stable release.
   */
  readonly channel: "local" | "dev" | "beta" | "prod"
  /**
   * Where the code runs. Main is always `desktop`.
   * - `web`: a browser tab.
   * - `desktop`: the Electron app.
   */
  readonly platform: "web" | "desktop"
  /** A packaged desktop app, not a development run. Always false on the web. */
  readonly packaged: boolean
}

declare const brand: unique symbol

/**
 * A token kind: a typed list that accepts contributions. The plugin or host that owns the registry decides how to
 * use its items; others `ctx.add` to it. Define one with `Registry.define`.
 *
 * @example
 * ```ts
 * export const Badge = Registry.define<{ readonly label: string }>("details.badge")
 * ctx.add(Badge, { label: "New" })
 * ```
 */
export interface Registry<T> {
  /** The token kind. */
  readonly kind: "registry"
  /** The registry's id; contributions are grouped by it. */
  readonly id: string
  /** Carries the item type `T` at compile time only; never set. */
  readonly [brand]?: T
}

/**
 * A token kind: an in-process contract one plugin provides from its window entry and others read with `ctx.use`.
 * Any interface, no schema; it never crosses IPC. Define one with `Contract.define` in the provider's `contract.ts`.
 *
 * @example
 * ```ts
 * export const FileTree = Contract.define<FileTree, "file.tree">("file.tree")
 * ctx.provide(FileTree, { open: (path) => reveal(path) })
 * ```
 */
export interface Contract<T, Id extends string = string> {
  /** The token kind. */
  readonly kind: "contract"
  /** The contract's id: `<plugin id>` or `<plugin id>.<name>`. */
  readonly id: Id
  /** Carries the contract type `T` at compile time only; never set. */
  readonly [brand]?: T
}

type Codec = Schema.ConstraintCodec<unknown, unknown>

/** One method of an `IpcSpec`. Values cross the bridge encoded by these schemas. */
export interface IpcMethod {
  /** The argument's schema. Omit it for a method that takes none. */
  readonly input?: Codec
  /** The result's schema. Omit it for a method that returns nothing. */
  readonly output?: Codec
}

/** The schemas of an Ipc: its state, methods and events. Pass it to `Ipc.define`. */
export interface IpcSpec {
  /**
   * The Ipc's id: the providing plugin's id, or `<plugin id>.<name>`. Once main has listed that plugin, it starts it
   * on demand when a window subscribes, before the other main plugins start.
   */
  readonly id: string
  /** Schema of the state main keeps per window (`IpcImpl.state`) and pushes with `changed`. Omit it for none. */
  readonly state?: Codec
  /** The methods a window calls, by name. */
  readonly methods: Readonly<Record<string, IpcMethod>>
  /** Schemas of the events main emits, by name. Omit it for none. */
  readonly events?: Readonly<Record<string, Codec>>
}

/**
 * A token kind: a contract the main entry provides and window entries use over the IPC bridge, typed by its schemas.
 * Define one with `Ipc.define` in `contract.ts`; provide it from main with `ctx.provide`, and call it from the plugin's
 * windows with `ctx.main`. On the web, where no main process runs, it is inactive and every call rejects.
 *
 * @example
 * ```ts
 * export const Pairing = Ipc.define({
 *   id: "pairing",
 *   methods: { screenActive: { output: Schema.Boolean }, setScreenActive: { input: Schema.Boolean } },
 * })
 * ```
 */
export interface Ipc<S extends IpcSpec = IpcSpec> {
  /** The token kind. */
  readonly kind: "ipc"
  /** The Ipc's id, `spec.id`. */
  readonly id: string
  /** The schemas the bridge encodes and decodes with. */
  readonly spec: S
}

/**
 * Something a plugin provides under its id and other code reads with `ctx.use`.
 * - `Contract`: in-process, from a window entry.
 * - `Ipc`: from a main entry, over the bridge.
 */
export type Token = Contract<unknown> | Ipc

type TypeOf<C> = C extends Codec ? C["Type"] : void

/**
 * How a window calls an Ipc, from `ctx.main` or an active `ctx.use`: one async function per method, plus `state`
 * and `on`. A method encodes its input with the method's schema and decodes the reply; it rejects when encoding fails,
 * when the Ipc is gone, or when main throws.
 *
 * @example
 * ```ts
 * const active = await pairing.screenActive({ signal: ctx.signal })
 * ```
 */
export type IpcClient<S extends IpcSpec> = {
  readonly [Name in keyof S["methods"]]: S["methods"][Name] extends { readonly input: Codec }
    ? (
        /** The argument decoded by this method's input schema. */
        input: TypeOf<S["methods"][Name]["input"]>,
        /** Optional per-call cancellation. */
        options?: IpcCallOptions,
      ) => Promise<TypeOf<S["methods"][Name]["output"]>>
    : (
        /** Optional per-call cancellation; no input placeholder is accepted. */
        options?: IpcCallOptions,
      ) => Promise<TypeOf<S["methods"][Name]["output"]>>
} & {
  /**
   * This window's state, as main's `IpcImpl.state` last pushed it. Undefined until the first snapshot arrives and
   * after the Ipc goes away. An event always wins over an older snapshot. Reactive.
   */
  state(): TypeOf<S["state"]> | undefined
  /**
   * Listens to one event. The listener is removed with the current owner (for example a `createKeyed` run), else
   * with the plugin.
   *
   * @param name - The event's name in `spec.events`.
   * @param listener - Receives the decoded event data.
   * @returns Removes the listener.
   */
  on<Name extends keyof NonNullable<S["events"]> & string>(
    name: Name,
    listener: (data: TypeOf<NonNullable<S["events"]>[Name]>) => void,
  ): Cleanup
}

/** Options for any Ipc method. A method without an input schema takes these as its only argument. */
export interface IpcCallOptions {
  /** Aborts the call: main's `Caller.signal` aborts, and the promise rejects. */
  readonly signal?: AbortSignal
}

/** The value a token gives its users: the contract itself, or the client of an Ipc. */
export type TokenValue<T> = T extends Ipc<infer S> ? IpcClient<S> : T extends Contract<infer V> ? V : never

/**
 * A provider as its users see it. The host returns one object per transition, so a reader re-runs only when the
 * provider changes.
 * - `pending`: the provider has not started yet, e.g. while its entry loads or before main is up.
 * - `active`: `value` is the contract or Ipc client. `generation` counts activations: a provider that restarts comes
 *   back with a new one.
 * - `inactive`: the provider is gone, and `reason` says why: `disabled` (turned off, absent, or not on this platform,
 *   such as every Ipc on the web) or `failed` (its setup threw). A provider that restarts is `pending` until it is
 *   back.
 *
 * @example
 * ```ts
 * const live = ctx.use(Changes)()
 * if (live.status === "active") live.value.open(session)
 * ```
 */
export type Live<T> =
  | {
      /** The provider has not started yet. */
      readonly status: "pending"
    }
  | {
      /** The provider is running. */
      readonly status: "active"
      /** The contract, or the Ipc client. */
      readonly value: T
      /** Counts activations, starting at 1; each restart brings a new one. */
      readonly generation: number
    }
  | {
      /** The provider is gone. */
      readonly status: "inactive"
      /**
       * Why the provider is gone.
       * - `disabled`: turned off, not composed, or not on this platform.
       * - `failed`: its setup threw.
       */
      readonly reason: "disabled" | "failed"
    }

/** Identifies the window an Ipc call came from. Main uses it to scope state and events. */
export interface Caller {
  /** The calling window's id (`BrowserWindow.id`); pass it to `changed` or `emit` to reach that window alone. */
  readonly window: number
  /** Aborts when the window aborts the call or the providing instance goes away. */
  readonly signal: AbortSignal
}

/**
 * What main passes to `ctx.provide(ipc, impl)`: one function per method, plus `state` when the spec has a state.
 * A method receives the decoded input and the `Caller`; its result is encoded with the method's output schema. A
 * throw rejects the window's call.
 */
export type IpcImpl<S extends IpcSpec> = {
  readonly [Name in keyof S["methods"]]: (
    input: TypeOf<S["methods"][Name]["input"]>,
    caller: Caller,
  ) => TypeOf<S["methods"][Name]["output"]> | Promise<TypeOf<S["methods"][Name]["output"]>>
} & (S["state"] extends Codec
  ? {
      /**
       * The state one window sees. Main reads it when the window subscribes and on every `changed`.
       *
       * @param window - The window's id.
       */
      state(window: number): TypeOf<S["state"]>
    }
  : unknown)

/**
 * Returned by `ctx.provide(ipc, impl)` in main. Every method does nothing once the provider is withdrawn.
 *
 * @example
 * ```ts
 * const provider = ctx.provide(Downloads, { state: () => downloads.state(), start, cancel })
 * provider.changed()
 * ```
 */
export interface IpcProvider<S extends IpcSpec> {
  /**
   * Re-reads `impl.state` and sends it to the windows that subscribed. Call it after every change of the state.
   *
   * @param window - One window's id. Omit it for every window.
   */
  changed(window?: number): void
  /**
   * Sends an event, encoded with its schema. An encoding failure is logged, not thrown.
   *
   * @param name - The event's name in `spec.events`; an unknown name throws.
   * @param data - The event's data.
   * @param window - One window's id. Omit it for every window.
   */
  emit<Name extends keyof NonNullable<S["events"]> & string>(
    name: Name,
    data: TypeOf<NonNullable<S["events"]>[Name]>,
    window?: number,
  ): void
  /**
   * Withdraws the Ipc before the instance goes away. Windows see it `pending`, and calls wait, until it is provided again
   * or the instance goes away. The host also withdraws it then.
   */
  dispose(): void
}

/**
 * What every entry gets, in the window and in main. Each process adds the APIs its host always provides as properties
 * (`ctx.layout`, `ctx.storage`, …), created on first read, and `provide` for the contracts it hosts.
 */
export interface BaseContext {
  /**
   * The plugin's options from `opencode.json`, as `ctx.options` in its server and TUI halves. Empty for a built-in.
   *
   * @example
   * ```ts
   * // "plugins": [{ "package": "opencode-acme", "options": { "team": "core" } }]
   * const team = ctx.options.team
   * ```
   */
  readonly options: PluginOptions
  /**
   * The client of the server that runs the plugin, the desktop app's own server, as `context.client` in a TUI plugin.
   * Call the plugin's server part through it. A new client after that server restarts; read it where you call it.
   * While the server is unreachable, every call rejects. A built-in plugin gets a client whose calls all reject.
   *
   * @example
   * ```ts
   * const result = await ctx.client.rpc(Acme).search({ query })
   * ```
   */
  readonly client: OpenCodeClient
  /**
   * The plugin's id, as its `Plugin.define` declares it.
   *
   * @example
   * ```ts
   * const key = `${ctx.id}:${tab.id}`
   * ```
   */
  readonly id: string
  /**
   * Aborts when the plugin is disabled or reloaded, or when its process ends: the window closes, or the app quits.
   * After an `await`, return if it aborted. A window has no owner after an `await`, so listen to the signal for
   * teardown that starts there.
   *
   * @example
   * ```ts
   * const config = await load({ signal: ctx.signal })
   * if (ctx.signal.aborted) return
   * ```
   */
  readonly signal: AbortSignal
  /**
   * Contributes an item that follows reactive state, such as the language: the window re-runs the function when what
   * it reads changes (main reads it on every `list`). Return undefined to withdraw the item until it returns one
   * again. The host withdraws it with the current owner (a `createKeyed` run or a component), else with the plugin;
   * made after that owner or the plugin ended, it is withdrawn at once.
   *
   * @param registry - Where the item goes, such as `Command` or `TitlebarItem`.
   * @param item - Returns the item, or undefined for none.
   * @returns Withdraws the item early.
   *
   * @example
   * ```ts
   * ctx.add(Command, () => ({ id: "toggle", title: ctx.t("toggle"), run: toggle }))
   * ctx.add(TitlebarItem, () => (shown() ? pill : undefined))
   * ```
   */
  add<T>(registry: Registry<T>, item: () => T | undefined): Cleanup
  /**
   * Contributes a fixed item to a registry. The host withdraws it with the current owner (a `createKeyed` run or a
   * component), else with the plugin; made after that owner or the plugin ended, it is withdrawn at once. Use the
   * function form for an item whose labels follow the language.
   *
   * @param registry - Where the item goes, such as `Command` or `Style`.
   * @param item - The item.
   * @returns Withdraws the item early.
   *
   * @example
   * ```ts
   * ctx.add(Style, css)
   * ```
   */
  add<T>(registry: Registry<T>, item: T): Cleanup
  /**
   * The items every plugin contributed to a registry, in contribution order. Reactive in the window. Use it for a
   * registry your plugin owns.
   *
   * @param registry - The registry to read.
   *
   * @example
   * ```ts
   * const badges = () => ctx.list(Badge)
   * ```
   */
  list<T>(registry: Registry<T>): readonly T[]
  /**
   * Translates a key from the plugin's catalog in the current locale, then from the app's shared keys
   * (`common.*`). Reactive in the window. Main returns the key itself when no catalog has it.
   *
   * @param key - The message key.
   * @param params - Values for the template's `{{name}}` placeholders.
   *
   * @example
   * ```ts
   * ctx.t("title")
   * ```
   */
  t(key: string, params?: Params): string
  /**
   * Translates a count-sensitive message: reads `<key>.<category>` for the locale's plural category of `count`, then
   * `<key>.other`. `{{count}}` is set for you.
   *
   * @param key - The base key, without the category.
   * @param count - The number that picks the category.
   * @param params - Other placeholders.
   *
   * @example
   * ```ts
   * ctx.plural("files", 3) // "3 files" from { "files.one": "{{count}} file", "files.other": "{{count}} files" }
   * ```
   */
  plural(key: string, count: number, params?: Params): string
}

/**
 * An older home of a stored value, imported once into a store that has no value yet: a stored key of the same
 * storage, such as the key of a store the plugin renamed, e.g. `"plugin.acme.settings"`. Where `from` takes a list,
 * it names several older homes, newest first, and the first that holds a value is imported. The older home keeps its
 * copy until the store is removed.
 *
 * @example
 * ```ts
 * Store.global(Prefs, { expanded: true }, ["plugin.acme.settings.v2", "plugin.acme.settings"])
 * ```
 */
export type StoreFrom = string

type StoreSchema = Schema.ConstraintCodec<object, unknown>

/** A store a plugin declares in `Plugin.define({ stores })`. Build one with `Store.global` or `Store.session`. */
export interface StoreDeclaration<
  S extends StoreSchema = StoreSchema,
  Scope extends "global" | "session" = "global" | "session",
> {
  /**
   * Where the value lives.
   * - `global`: one value for the app, loaded before setup.
   * - `session`: one value per session, loaded when the session mounts.
   */
  readonly scope: Scope
  /**
   * Decodes the stored JSON; an object schema. A field of a plain struct that is missing or fails to decode takes its
   * `initial` value; a value that fails as a whole reads as `initial`.
   */
  readonly schema: S
  /** The value before anything is stored, and after `Storage.remove`. */
  readonly initial: S["Type"]
  /** Older homes the value is imported from once. See `StoreFrom`. */
  readonly from?: StoreFrom | readonly StoreFrom[]
}

/**
 * Declares window state. The store's name in `stores` is its key, stored as `plugin.<id>.<name>`. Desktop windows
 * load storage over IPC, so the host loads declared stores for you before they are read. The main process opens its
 * state with `ctx.storage.store`, which reads synchronously.
 *
 * @example
 * ```ts
 * stores: {
 *   prefs: Store.global(Prefs, { shown: true }, "plugin.acme.settings"),
 *   view: Store.session(View, { open: [] }),
 * }
 * ```
 */
export const Store = {
  /**
   * One value for the app. The host loads every global store before setup, so `ctx.stores.name.value` is never
   * undefined. A load that fails fails the plugin's setup.
   *
   * @param schema - Decodes the stored JSON; an object schema.
   * @param initial - The value before anything is stored.
   * @param from - Older homes to import the value from once.
   */
  global: <S extends StoreSchema>(
    schema: S,
    initial: NoInfer<S["Type"]>,
    from?: StoreFrom | readonly StoreFrom[],
  ): StoreDeclaration<S, "global"> => ({
    scope: "global",
    schema,
    initial,
    from,
  }),
  /**
   * One value per session. The host starts loading it when the session mounts, before its regions render;
   * `ctx.stores.name(session).value` is undefined until then and while the session's location is unknown.
   *
   * @param schema - Decodes the stored JSON; an object schema.
   * @param initial - The value before anything is stored.
   * @param from - Older homes to import the value from once.
   */
  session: <S extends StoreSchema>(
    schema: S,
    initial: NoInfer<S["Type"]>,
    from?: StoreFrom | readonly StoreFrom[],
  ): StoreDeclaration<S, "session"> => ({ scope: "session", schema, initial, from }),
}

/**
 * Stored state, the same shape in both processes. `V` is the value's type while it may still be loading: a global
 * declared store and every main store use `T`, so `value` is never undefined.
 *
 * @example
 * ```ts
 * const prefs = ctx.stores.prefs
 * prefs.update((draft) => { draft.shown = !draft.shown })
 * prefs.set({ shown: true })
 * ```
 */
export interface Persisted<T, V = T | undefined> {
  /** The stored value; undefined until it has loaded. Reactive in the window. */
  readonly value: V
  /** The stored value has loaded. Always true in main. Reactive in the window. */
  ready(): boolean
  /**
   * Mutates a deep-mutable draft, even when the schema's fields are readonly. Return nothing or `undefined`;
   * returning a replacement is a compile error and throws at runtime. Use `set` to replace the value. In the
   * window it waits for load and applies in call order with `set`; in main it writes at once.
   *
   * @param mutate - Edits a draft of the current value in place.
   */
  update(
    mutate: (
      /** A deep-mutable copy of the current value; edit it in place. */
      draft: Mutable<T>,
    ) => undefined,
  ): void
  /**
   * Replaces the stored value. In the window it waits for load and applies in call order with `update`; in main it
   * writes at once. Use this for primitives or to replace an object or collection.
   *
   * @param next - The complete next value, typed by the store's schema.
   */
  set(next: T): void
}

/** A stored value's writable draft, recursively removing readonly fields and collection entries. */
export type Mutable<T> = T extends object ? { -readonly [K in keyof T]: Mutable<T[K]> } : T

/** The stores a definition declares; `{}` when it declares none. */
export type DeclaredStores<D> = D extends { readonly stores?: infer M }
  ? M extends Readonly<Record<string, StoreDeclaration>>
    ? M
    : {}
  : {}

/**
 * Defines registries.
 *
 * @example
 * ```ts
 * export const Badge = Registry.define<{ readonly label: string }>("details.badge")
 * ```
 */
export const Registry = {
  /**
   * Creates a registry token.
   *
   * @param id - The registry's id; start it with your plugin's id.
   */
  define: <T>(id: string): Registry<T> => ({ kind: "registry", id }),
}

/**
 * Defines in-process contracts.
 *
 * @example
 * ```ts
 * export const Changes = Contract.define<Changes, "review.changes">("review.changes")
 * ```
 */
export const Contract = {
  /**
   * Creates a contract token.
   *
   * @param id - The contract's id: your plugin's id, or `<id>.<name>`. Only that plugin may provide it.
   */
  define: <T, const Id extends string>(id: Id): Contract<T, Id> => ({ kind: "contract", id }),
}

/**
 * Defines Ipcs between a plugin's main entry and its windows.
 *
 * @example
 * ```ts
 * export const Pairing = Ipc.define({ id: "pairing", methods: { screenActive: { output: Schema.Boolean } } })
 * ```
 */
export const Ipc = {
  /**
   * Creates an Ipc token from its schemas.
   *
   * @param spec - The Ipc's id, state, methods and events.
   */
  define: <const S extends IpcSpec>(spec: S): Ipc<S> => ({ kind: "ipc", id: spec.id, spec }),
}
