import type { Schema } from "effect"
import type { Accessor } from "solid-js"

/**
 * Undoes a registration, or tears something down. Every `add`, `provide`, `on` and finalizer returns or takes one.
 * Calling it early withdraws at once; a second call does nothing. When the host runs it, a throw or a rejection is
 * logged and the other cleanups still run; main's `Scope` waits for a returned promise until its deadline.
 */
export type Cleanup = () => void | Promise<void>

/**
 * An operating system, as `Definition.os` and `Desktop.os` name it.
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
 * An extension's copy by locale. English ships inline and fills every key a locale lacks; another locale is inline
 * messages or a loader the host calls when the user picks that locale. A loader that fails leaves English.
 *
 * @example
 * ```ts
 * i18n: { en, de: () => import("./i18n/de") }
 * ```
 */
export type Catalog = {
  /** English, the source copy and the fallback for every key. */
  readonly en: Messages
} & {
  readonly [locale: string]:
    | Messages
    | (() => Promise<{
        /** The locale's messages. */
        readonly default: Messages
      }>)
}

/**
 * What a main entry's setup returns. Teardown is not returned: main uses `ctx.scope.addFinalizer` and
 * `ctx.scope.signal`. Window setup is synchronous and returns nothing.
 */
type Result = void | Promise<void>

/** The running build. One shape in the window and in main. */
export interface Build {
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

/**
 * An extension's manifest: its id, what it provides and depends on, its stored state and its entries. Build one with
 * `Extension.define`; the host reads it before any entry loads.
 */
export interface Definition {
  /**
   * The extension's id and the prefix of every id it creates: commands (`<id>.<command>`), panel keys (`<id>:<tab>`),
   * stored keys (`extension.<id>.<key>`), and its contract and Ipc ids (`<id>` or `<id>.<name>`). Changing it moves
   * all of those; migrate them as the guide describes.
   */
  readonly id: string
  /**
   * Earlier extension ids, newest first, used to preserve desktop enable state after a rename. The current id's
   * explicit setting wins; otherwise the first earlier id with a setting wins. Omit this for a new extension.
   * With no setting under any id, the extension is enabled. Old rows stay intact; changes write under the current id.
    * Stored keys, commands and panels still need their own migrations (`from`, the keybind map and `Panel.legacy`).
    * This restores the enable preference only; hard dependencies still gate activation and can leave it blocked.
   *
   * @example
   * ```ts
   * Extension.define({ id: "details", legacy: ["summary"] })
   * ```
   */
  readonly legacy?: readonly string[]
  /**
   * The operating systems the extension runs on. Omit it to run everywhere, the web included. An extension that lists
   * any OS does not run on the web, where no OS is known.
   */
  readonly os?: readonly OS[]
  /** The extension's copy. `ctx.t` reads it first, then the app's shared keys such as `common.*`. */
  readonly i18n?: Catalog
  /**
   * Tokens this extension provides: Contracts from its window entry (`ctx.provide`), Ipcs from its main entry.
   * `Extension.compose` refuses two providers of one token. The window entry also reads each one as `ctx.uses.<key>`,
   * a `Live` accessor, so an extension that talks to its own main entry lists that Ipc here only.
   */
  readonly provides?: Tokens
  /**
   * Optional dependencies that other extensions provide. Each is a `Live` accessor in `ctx.uses`: pending while its
   * provider loads, inactive while it is disabled, failed, blocked or restarting. The extension must keep working while one is
   * inactive. Your own tokens need no entry: `provides` already puts them in `ctx.uses`. A key that names one token in
   * `provides` and another here fails to compile (`Conflict<"key">`).
   */
  readonly uses?: Tokens
  /**
   * Hard dependencies. The host starts the extension only while every one is active and restarts it with them; the
   * values are plain in `ctx.requires`. Use it only where the extension is meaningless without the contract. A
   * reference (`Ipc.ref`) is refused: it resolves only once code loads the full token, which setup would do.
   */
  readonly requires?: Readonly<Record<string, Contract<unknown> | Ipc>>
  /**
   * State the host stores for the extension, by store name. Each process's `ctx.stores` holds only its own:
   * `Store.global` and `Store.session` are window state, loaded before they are read; `Store.main` is main-process
   * state, always loaded. See `Store`. Keys known only at runtime go through `ctx.storage.store`.
   */
  readonly stores?: Readonly<Record<string, StoreDeclaration | MainStoreDeclaration>>
  /** The window entry; its default export is a `Setup<typeof Definition>` (`@opencode/gui-extensions/sdk`). */
  readonly renderer?: () => Promise<{
    /** The window setup. */
    readonly default: (ctx: never) => void
  }>
  /** The main entry; its default export is a `MainSetup` (`@opencode/gui-extensions/sdk/main`). */
  readonly main?: () => Promise<{
    /** The main setup. */
    readonly default: (ctx: never) => Result
  }>
}

// Loose on purpose: checking an entry's module while its definition is still being inferred would be circular.
type Entries = {
  readonly renderer?: () => Promise<object>
  readonly main?: () => Promise<object>
}

declare const brand: unique symbol

declare const problem: unique symbol

/**
 * A token kind: a typed list that accepts contributions. The extension or host that owns the registry decides how to
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
 * A token kind: an in-process contract one extension provides from its window entry and others declare in `uses`
 * or `requires`. Any interface, no schema; it never crosses IPC. Define one with `Contract.define` in the provider's
 * `contract.ts`.
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
  /** The contract's id: `<extension id>` or `<extension id>.<name>`. */
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
   * The Ipc's id: the providing extension's id, or `<extension id>.<name>`. Main starts that extension on demand when
   * a window subscribes, before the other main extensions start.
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
 * Define one with `Ipc.define` in `contract.ts`; provide it from main with `ctx.provide`, and read it in a window from
 * `ctx.uses`. On the web, where no main process runs, it is always inactive.
 *
 * @example
 * ```ts
 * export const Pairing = Ipc.define({
 *   id: "pairing",
 *   methods: { info: { output: PairingInfo }, setScreenActive: { input: Schema.Boolean } },
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
 * A token kind: an Ipc declared by id and typed by its token, with no spec at runtime, so a definition can name it
 * without loading its schemas. It is pending until window code passes the full token to `ctx.uses.name.load`. See
 * `Ipc.ref`.
 *
 * @example
 * ```ts
 * const Pane = Ipc.ref<typeof BrowserPane>("browser.pane")
 * Extension.define({ id: "browser", provides: { pane: Pane } })
 * ```
 */
export interface IpcRef<S extends IpcSpec = IpcSpec> {
  /** The token kind; a reference is an Ipc without its spec. */
  readonly kind: "ipc"
  /** The referenced Ipc's id. */
  readonly id: string
  /** Always undefined: the schemas arrive with the full token. */
  readonly spec?: undefined
  /** Carries the spec type `S` at compile time only; never set. */
  readonly [brand]?: S
}

/**
 * A dependency one extension provides and others declare in `uses` or `requires`.
 * - `Contract`: in-process, from a window entry.
 * - `Ipc`: from a main entry, over the bridge.
 * - `IpcRef`: an Ipc named without its schemas.
 */
export type Token = Contract<unknown> | Ipc | IpcRef

/** Tokens by the name the context exposes them under, as in `provides: { tree: FileTree }`. */
export type Tokens = Readonly<Record<string, Token>>

type TypeOf<C> = C extends Codec ? C["Type"] : void

/**
 * What a window reads from an active `ctx.uses.name` for an Ipc: one async function per method, plus `state` and
 * `on`. A method encodes its input with the method's schema and decodes the reply; it rejects when encoding fails,
 * when the Ipc is gone, or when main throws.
 *
 * @example
 * ```ts
 * const info = await pairing.info({ signal: ctx.signal })
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
   * Listens to one event. Through `ctx.uses` the listener is removed with the current owner (for example a
   * `createKeyed` run), else with the extension.
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
export type TokenValue<T> =
  T extends Ipc<infer S>
    ? IpcClient<S>
    : T extends IpcRef<infer S>
      ? IpcClient<S>
      : T extends Contract<infer V>
        ? V
        : never

/**
 * A provider as its users see it. The host returns one object per transition, so a reader re-runs only when the
 * provider changes.
 * - `pending`: the provider has not started yet, e.g. while its entry loads or before main is up.
 * - `active`: `value` is the contract or Ipc client. `generation` counts activations: a provider that restarts comes
 *   back with a new one.
 * - `inactive`: the provider is gone, and `reason` says why: `disabled` (turned off, absent, or not on this platform,
 *   such as every Ipc on the web), `failed` (its setup threw), `blocked` (a hard dependency is unavailable), or
 *   `restarting` (it was active before and is coming back).
 *
 * @example
 * ```ts
 * const live = ctx.uses.changes()
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
       * - `blocked`: a hard dependency is disabled, failed or itself blocked.
       * - `restarting`: it was active before and is coming back.
       */
      readonly reason: "disabled" | "failed" | "blocked" | "restarting"
    }

const live = Symbol.for("opencode.extension.live")

/**
 * Helpers for `Live` accessors. Extension code reads `ctx.uses.*` and passes them to `createKeyed`; it rarely calls
 * these.
 *
 * @example
 * ```ts
 * createKeyed(ctx.uses.changes, (changes) => changes.onReveal(refresh))
 * ```
 */
export const Live = {
  /**
   * For the host: marks an accessor as one `ctx.uses` holds, so `createKeyed` follows its generations.
   *
   * @param read - Returns the provider's current `Live` value, one object per transition.
   * @returns The same function, marked.
   */
  accessor: <T>(read: () => Live<T>): Accessor<Live<T>> => Object.assign(read, { [live]: true }),
  /**
   * Whether the host marked the accessor with `Live.accessor`.
   *
   * @param source - Any accessor.
   * @returns True for the accessors in `ctx.uses`.
   */
  is: (source: Accessor<unknown>): source is Accessor<Live<unknown>> => live in source,
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
 * const provider = ctx.provide(Updater, { state: () => updater.state(), check, install })
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
  /** Withdraws the Ipc before the instance goes away; windows see it inactive. The host also withdraws it then. */
  dispose(): void
}

/**
 * What every entry gets, in the window and in main. Each process adds the APIs its host always provides as properties
 * (`ctx.layout`, `ctx.storage`, …), created on first read, and `provide` for the contracts it hosts.
 */
export interface BaseContext {
  /**
   * The extension's id, `Definition.id`.
   *
   * @example
   * ```ts
   * const key = `${ctx.id}:${tab.id}`
   * ```
   */
  readonly id: string
  /**
   * Contributes an item to a registry. The host withdraws it with the current owner (a `createKeyed` run or a
   * component), else with the extension; made after that owner or the extension ended, it is withdrawn at once.
   *
   * @param registry - Where the item goes, such as `Command` or `TitlebarItem`.
   * @param item - The item, or a function returning it. A function is reactive in the window (main reads it on every
   *   `list`); return undefined to withdraw the item until the function returns one again.
   * @returns Withdraws the item early.
   *
   * @example
   * ```ts
   * ctx.add(Command, { id: "toggle", title: ctx.t("toggle"), run: toggle })
   * ctx.add(TitlebarItem, () => (shown() ? pill : undefined))
   * ```
   */
  add<T>(registry: Registry<T>, item: T | (() => T | undefined)): Cleanup
  /**
   * The items every extension contributed to a registry, in contribution order. Reactive in the window. Use it for a
   * registry your extension owns.
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
   * Translates a key from the extension's catalog in the current locale, then from the app's shared keys
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
 * An older home of a stored value, imported once into a store that has no value yet. Where `from` takes a list, it
 * names several older homes, newest first, and the first that holds a value is imported: for example an extension's
 * earlier storage namespace, then the app key that namespace once replaced. The older home keeps its copy until the
 * store is removed.
 * - A string: a stored key of the same storage, e.g. `"extension.summary.prefs"` or `"workspace:terminal"`.
 * - An object: a part of a shared key, chosen by `pick`.
 *
 * @example
 * ```ts
 * Store.global(Prefs, { projectExpanded: true }, [
 *   "extension.summary.prefs",
 *   { key: "settings.v3", pick: (value: { sessionSummary?: unknown } | null) => value?.sessionSummary },
 * ])
 * ```
 */
export type StoreFrom =
  | string
  | {
      /** The raw stored key that holds the older value. */
      readonly key: string
      /**
       * For session scope: `key` is a global key (e.g. "layout") whose field `sessions` holds every session's
       * state by the host's session key. pick receives only this session's entry, or undefined.
       */
      readonly sessions?: string
      /**
       * Returns the part of the older JSON this store keeps, or undefined for none. The store decodes it as it decodes
       * a stored value (see `StoreDeclaration.schema`). With `pick`, the older key stays for its other owners.
       *
       * @param value - The older key's parsed JSON, or null when it is missing; with `sessions`, this session's entry
       *   or undefined.
       */
      // SAFETY: the older value is stored JSON with no schema of its own; the store decodes what pick returns.
      // oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- see SAFETY above
      pick(value: unknown): unknown
    }

type StoreSchema = Schema.ConstraintCodec<object, unknown>

/** A store an extension declares in `Extension.define({ stores })`. Build one with `Store.global` or `Store.session`. */
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
 * An older home of a main store's value, imported once while the store holds nothing. Where `from` takes a list, it
 * names several, newest first, and the first that holds a value is imported. The older home keeps its copy until the
 * store is removed.
 * - `{ settings, file? }`: a key of a desktop settings file, the app's own unless `file` names another.
 * - `{ state }`: a key of another main storage namespace.
 *
 * @example
 * ```ts
 * Store.main(Schema.Boolean, false, { state: ["opencode.settings", "keepScreenActive"] })
 * ```
 */
export type MainStoreFrom =
  | {
      /** The key in the settings file, e.g. `ssh.servers`. */
      readonly settings: string
      /** Another settings file of the desktop app, e.g. `opencode.updater`. Defaults to the app's settings file. */
      readonly file?: string
    }
  | {
      /** The storage namespace and the key in it, e.g. `["opencode.settings", "keepScreenActive"]`. */
      readonly state: readonly [namespace: string, key: string]
    }

type MainSchema = Schema.ConstraintCodec<unknown, unknown>

/** A main-process store an extension declares in `Extension.define({ stores })`. Build one with `Store.main`. */
export interface MainStoreDeclaration<S extends MainSchema = MainSchema> {
  /** Where the value lives: `main`, one value for the app in main storage. */
  readonly scope: "main"
  /**
   * Decodes the stored JSON; any schema that needs no services. A stored value that fails to decode reads as
   * `initial`.
   */
  readonly schema: S
  /** The value before anything is stored, and after `Storage.remove`. */
  readonly initial: S["Type"]
  /** Older homes the value is imported from once. See `MainStoreFrom`. */
  readonly from?: MainStoreFrom | readonly MainStoreFrom[]
}

/**
 * Declares stored state. The store's name in `stores` is its key: window stores are stored as `extension.<id>.<name>`,
 * main stores under the name in main storage's `extension.<id>` namespace. Desktop windows load storage over IPC, so
 * the host loads declared window stores for you before they are read; main storage reads synchronously.
 *
 * @example
 * ```ts
 * stores: {
 *   prefs: Store.global(Prefs, { shown: true }, "extension.summary.prefs"),
 *   view: Store.session(View, { open: [] }),
 *   count: Store.main(Schema.Number, 0),
 * }
 * ```
 */
export const Store = {
  /**
   * One value for the app. The host loads every global store before setup, so `ctx.stores.name.value` is never
   * undefined. A load that fails fails the extension's setup.
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
   * @param from - Older homes to import the value from once; `{ key, sessions, pick }` reads one session's entry of a
   *   global key.
   */
  session: <S extends StoreSchema>(
    schema: S,
    initial: NoInfer<S["Type"]>,
    from?: StoreFrom | readonly StoreFrom[],
  ): StoreDeclaration<S, "session"> => ({ scope: "session", schema, initial, from }),
  /**
   * One value for the app in the main process. The main entry reads it as `ctx.stores.name`, whose `value` is always
   * defined: main storage reads synchronously, and each write reaches the database before it returns. The window
   * entry's `ctx.stores` does not hold it.
   *
   * @param schema - Decodes the stored JSON; any schema that needs no services, so a number, `null` or a list works.
   * @param initial - The value before anything is stored.
   * @param from - Older homes to import the value from once, newest first.
   */
  main: <S extends MainSchema>(
    schema: S,
    initial: NoInfer<S["Type"]>,
    from?: MainStoreFrom | readonly MainStoreFrom[],
  ): MainStoreDeclaration<S> => ({ scope: "main", schema, initial, from }),
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

/** The tokens a definition declares under `K`; `{}` when it declares none. */
export type Declared<D, K extends "provides" | "uses" | "requires"> = D extends { readonly [P in K]?: infer M }
  ? M extends Tokens
    ? M
    : {}
  : {}

/** The stores a definition declares, window and main alike; `{}` when it declares none. */
export type DeclaredStores<D> = D extends { readonly stores?: infer M }
  ? M extends Readonly<Record<string, StoreDeclaration | MainStoreDeclaration>>
    ? M
    : {}
  : {}

/** The id a token declares, for compile errors. */
export type TokenId<T> =
  T extends Ipc<infer S>
    ? S["id"]
    : T extends IpcRef<infer S>
      ? S["id"]
      : T extends Contract<unknown, infer Id>
        ? Id
        : never

/** `Extension.compose`'s error: a `requires` token that no extension in the composition provides. */
export interface Missing<Id extends string> {
  /** The token's id. */
  readonly [problem]: Id
}

/** `Extension.compose`'s error: a token that two extensions in the composition provide. */
export interface Duplicate<Id extends string> {
  /** The token's id. */
  readonly [problem]: Id
}

/** `Extension.compose`'s error: two definitions use the same extension id. */
export interface DuplicateExtension<Id extends string> {
  /** The repeated extension id. */
  readonly [problem]: Id
}

/** `IpcsProvided`'s error: a window `provides`, `uses` or `requires` of an Ipc that no main entry provides. */
export interface MissingMain<Id extends string> {
  /** The Ipc's id. */
  readonly [problem]: Id
}

/** `Extension.define`'s error: a key that names one token in `provides` and another in `uses`. */
export interface Conflict<Key extends string> {
  /** The key both records use. */
  readonly [problem]: Key
}

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

type SharedKeys<D> = keyof Declared<D, "provides"> & keyof Declared<D, "uses"> & string

type ConflictingKeys<D> = {
  [K in SharedKeys<D>]: Same<Declared<D, "provides">[K], Declared<D, "uses">[K]> extends true ? never : K
}[SharedKeys<D>]

/** Compile errors for a definition; `unknown` when it is valid. */
export type DefinitionCheck<D> = [ConflictingKeys<D>] extends [never]
  ? unknown
  : {
      /** This key names one token in `provides` and another in `uses`. */
      readonly "conflicting key": Conflict<ConflictingKeys<D>>
    }

/**
 * What `ctx.uses` holds, by key: every token of `provides`, then those of `uses`. `Extension.define` refuses a key
 * that names two different tokens, so the merge never hides one.
 */
export type Usable<D> = Omit<Declared<D, "provides">, keyof Declared<D, "uses">> & Declared<D, "uses">

type Literal<Id> = Id extends string ? (string extends Id ? never : Id) : never

// Distributes over a union of definitions, so each contributes its own declared ids.
type Ids<D, K extends "provides" | "uses" | "requires"> = D extends unknown
  ? TokenId<Declared<D, K>[keyof Declared<D, K>]>
  : never

type Others<Ds extends readonly unknown[], I> = { [J in keyof Ds]: J extends I ? never : Ds[J] }[number]

type MissingIds<Ds extends readonly unknown[]> = Exclude<Ids<Ds[number], "requires">, Ids<Ds[number], "provides">>

type DuplicateIds<Ds extends readonly unknown[]> = {
  [I in keyof Ds]: Literal<Ids<Ds[I], "provides">> & Ids<Others<Ds, I>, "provides">
}[number]

type ExtensionId<D> = D extends { readonly id: infer Id } ? Literal<Id> : never

type DuplicateExtensions<Ds extends readonly unknown[]> = {
  [I in keyof Ds]: ExtensionId<Ds[I]> & ExtensionId<Others<Ds, I>>
}[number]

/** Compile errors for a composition; `unknown` when it is valid. */
export type Composition<Ds extends readonly unknown[]> = [DuplicateExtensions<Ds>] extends [never]
  ? ProvidersCheck<Ds>
  : {
      /** Two definitions share this extension id. */
      readonly "duplicate extension": DuplicateExtension<DuplicateExtensions<Ds>>
    }

type ProvidersCheck<Ds extends readonly unknown[]> = [MissingIds<Ds>] extends [never]
  ? [DuplicateIds<Ds>] extends [never]
    ? unknown
    : {
        /** Two extensions provide this token. */
        readonly "duplicate provider": Duplicate<DuplicateIds<Ds>>
      }
  : {
      /** No extension provides this `requires` token. */
      readonly "missing provider": Missing<MissingIds<Ds>>
    }

type IpcIds<D, K extends "provides" | "uses" | "requires"> = D extends unknown
  ? TokenId<Extract<Declared<D, K>[keyof Declared<D, K>], Ipc | IpcRef>>
  : never

// A window reads its own `provides` through `ctx.uses` too, so those Ipcs need a main entry as well.
type MissingIpcs<R extends readonly unknown[], M extends readonly unknown[]> = Exclude<
  IpcIds<R[number], "provides"> | IpcIds<R[number], "uses"> | IpcIds<R[number], "requires">,
  IpcIds<Extract<M[number], { readonly main: unknown }>, "provides">
>

/**
 * `true` when every Ipc the window composition `R` declares in `provides`, `uses` or `requires` is provided by an entry
 * with a main module in the main composition `M`; otherwise an error type naming the Ipc. Check it once in a file that
 * imports both compositions.
 *
 * @example
 * ```ts
 * export const ipcs: IpcsProvided<typeof renderer, typeof main> = true
 * ```
 */
export type IpcsProvided<R extends readonly unknown[], M extends readonly unknown[]> = [MissingIpcs<R, M>] extends [
  never,
]
  ? true
  : MissingMain<MissingIpcs<R, M>>

/**
 * Defines and composes extensions.
 *
 * @example
 * ```ts
 * export default Extension.define({ id: "pairing", provides: { pairing: Pairing }, i18n: { en } })
 * export const builtins = Extension.compose(review, file, browser)
 * ```
 */
export const Extension = {
  /**
   * Returns the definition with its declarations typed; `Setup<typeof Definition>` reads them. The entries are checked
   * where the definition is composed, so `renderer: () => import("./renderer")` may name `Setup<typeof Definition>`.
   * Fails to compile, naming the key, when a key names one token in `provides` and another in `uses`
   * (`Conflict<"key">`).
   *
   * @param definition - The extension's manifest.
   * @returns The same object.
   */
  define: <const D extends Omit<Definition, "renderer" | "main"> & Entries>(definition: D & DefinitionCheck<D>): D =>
    definition,
  /**
   * Returns the definitions as they are. Fails to compile, naming the token id, when a `requires` token has no
   * provider in the composition (`Missing<"id">`), when two extensions provide the same token (`Duplicate<"id">`),
   * or when two definitions share an extension id (`DuplicateExtension<"id">`).
   *
   * @param definitions - Every extension of one process, each with its entry.
   * @returns The same definitions, as an array.
   */
  compose: <const Ds extends readonly Definition[]>(...definitions: Ds & Composition<Ds>): Ds => definitions,
}

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
   * @param id - The registry's id; start it with your extension's id.
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
   * Creates a contract token. Pass the id as a type argument too, so composition errors name it.
   *
   * @param id - The contract's id: your extension's id, or `<id>.<name>`.
   */
  define: <T, const Id extends string>(id: Id): Contract<T, Id> => ({ kind: "contract", id }),
}

type SpecOf<R> = R extends Ipc<infer S> ? S : never

/**
 * Defines Ipcs between an extension's main entry and its windows.
 *
 * @example
 * ```ts
 * export const Pairing = Ipc.define({ id: "pairing", methods: { code: { output: Schema.String } } })
 * const Pane = Ipc.ref<typeof BrowserPane>("browser.pane")
 * ```
 */
export const Ipc = {
  /**
   * Creates an Ipc token from its schemas.
   *
   * @param spec - The Ipc's id, state, methods and events.
   */
  define: <const S extends IpcSpec>(spec: S): Ipc<S> => ({ kind: "ipc", id: spec.id, spec }),
  /**
   * Declares an Ipc by id, typed from a type-only import of its token, so a definition can name it in `provides`,
   * `uses` or `requires` without loading its schemas: `Ipc.ref<typeof BrowserPane>("browser.pane")`. Composition
   * checks and `Live` typing treat it as the token. In the window it is pending until code in the window loads the
   * full token, e.g. `ctx.uses.pane.load(BrowserPane)` from a chunk that loads later. Declare it in `provides` (your
   * own Ipc) or `uses`: a `requires` would wait for a resolution that setup itself would make.
   *
   * @param id - The full token's id; another id fails to compile.
   */
  ref: <R extends Ipc>(id: TokenId<R>): IpcRef<SpecOf<R>> => ({ kind: "ipc", id }),
}
