// The parts of the SDK only the app's built-in plugins use, for workspace imports only: `tsconfig.build.json` leaves it
// out of `dist`, and `script/pack.ts` exports it as `null`. Public SDK modules never import it.

import type { Schema } from "effect"
import type { Context } from "./context.js"
import { Registry, type Catalog, type Messages, type Persisted, type StoreDeclaration, type StoreFrom } from "./core.js"
import type { Desktop, Layout, Locale, StorageScope, StoreOptions } from "./host-apis.js"
import type { MainContext } from "./main.js"
import type { Command, IconName, Panel, PanelTab, SlotMap } from "./registries.js"
import { type JSX } from "solid-js"

/**
 * Runs fn when the main thread is idle (a short timeout where requestIdleCallback is missing, e.g. Safari). Load lazy
 * chunks this way from setup, so they are compiled before a session first opens.
 *
 * @param fn - The work to run.
 * @returns Cancels it if it has not run.
 *
 * @example
 * ```ts
 * const Page = lazy(() => import("./page"))
 * onCleanup(onIdle(() => void Page.preload()))
 * ```
 */
export function onIdle(fn: () => void) {
  if (typeof requestIdleCallback !== "undefined") {
    const id = requestIdleCallback(fn)

    return () => cancelIdleCallback(id)
  }

  const id = setTimeout(fn, 200)

  return () => clearTimeout(id)
}

/** A `Command` with the fields only built-ins set. */
export interface BuiltinCommand extends Command {
  /**
   * Published command id whose shortcut this command shares, e.g. `tab.close` for a command that closes a tab inside
   * its `scope`. The command takes that command's custom shortcut, or `bind` while it has none, and Settings >
   * Shortcuts lists only that command. Pair it with `scope`, so the shared shortcut reaches this command only there.
   */
  readonly follows?: string
}

/**
 * The `Command` registry, with the fields only built-ins set. The host reads every command through it.
 *
 * @example
 * ```ts
 * ctx.add(BuiltinCommand, { id: "close", title: ctx.t("close"), follows: "tab.close", scope: SCOPE, run: close })
 * ```
 */
export const BuiltinCommand = Registry.define<BuiltinCommand>("command")

/** A `PanelTab` with the fields only built-ins set. */
export interface BuiltinPanelTab extends PanelTab {
  /**
   * Renders before the tabs in stored order. Opening it also stores it first and leaves the preview tab open, so
   * closing it selects the first remaining tab. Fallback selection takes a `first` tab after the regular tabs and
   * before a pinned tab.
   */
  readonly first?: boolean
  /** Stable DOM ids for the trigger and the tab panel. */
  readonly dom?: {
    /** The trigger's id. */
    readonly tab?: string
    /** The tab panel's id. */
    readonly panel?: string
  }
}

/** A `Panel` with the fields only built-ins set. */
export interface BuiltinPanel extends Panel {
  /**
   * Stored tab keys from before plugins (e.g. "review"), or from this plugin's earlier id, mapped to this panel's tab
   * ids. The host rewrites them once.
   */
  readonly legacy?: Readonly<Record<string, string>>
  /**
   * Lists the panel's tabs, as `Panel.list` does; a tab may set the built-in fields.
   *
   * @param input - A session getter, the constant owning screen and this call's stored tab ids.
   */
  list(input: Parameters<Panel["list"]>[0]): readonly BuiltinPanelTab[]
}

/**
 * The `Panel` registry, with the fields only built-ins set. The host reads every panel through it.
 *
 * @example
 * ```ts
 * ctx.add(BuiltinPanel, { id: "main", region: "side", legacy: { review: "main" }, list, render })
 * ```
 */
export const BuiltinPanel = Registry.define<BuiltinPanel>("panel")

/** The slots of `SlotMap`, and those only built-ins fill. */
export interface BuiltinSlotMap extends SlotMap {
  /**
   * Replaces the project menu's current location row; one contribution owns it. Without one the host shows a static
   * row.
   */
  readonly "session.location.workspace": SlotMap["session.location.menu"] & {
    /** The current worktree name, or the localized label for the local repository. */
    readonly label: string
    /** The location icon: monitor for the local repository, worktree for a worktree. */
    readonly icon: IconName
  }
}

/** A `Slot` that may also fill the slots only built-ins use. */
export type BuiltinSlot = {
  [At in keyof BuiltinSlotMap]: {
    /** The slot; see `BuiltinSlotMap`. */
    readonly at: At
    /** Slot contents render in ascending order. Defaults to 0. */
    readonly order?: number
    /**
     * Renders the content once; its own reactivity updates it.
     *
     * @param input - The slot's input.
     */
    render(input: BuiltinSlotMap[At]): JSX.Element
  }
}[keyof BuiltinSlotMap]

/**
 * The `Slot` registry, with the slots only built-ins fill. The host reads every slot through it.
 *
 * @example
 * ```ts
 * ctx.add(BuiltinSlot, { at: "session.location.workspace", render: (input) => <Row {...input} /> })
 * ```
 */
export const BuiltinSlot = Registry.define<BuiltinSlot>("slot")

/**
 * An older home of a built-in's window value, imported once into a store that has no value yet: a `StoreFrom` key, or
 * a part of a shared app key, chosen by `pick`. The older home keeps its copy until the store is removed; a key it
 * picks a part of stays for its other owners, while the store keeps a marker that blocks the import.
 *
 * @example
 * ```ts
 * BuiltinStore.global(Prefs, { projectExpanded: true }, {
 *   key: "settings.v3",
 *   pick: (value: { sessionSummary?: unknown } | null) => value?.sessionSummary,
 * })
 * ```
 */
export type BuiltinStoreFrom =
  | StoreFrom
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

/** A `StoreDeclaration` whose older homes may be parts of shared app keys. Build one with `BuiltinStore`. */
export interface BuiltinStoreDeclaration<
  S extends StoreDeclaration["schema"] = StoreDeclaration["schema"],
  Scope extends "global" | "session" = "global" | "session",
> extends StoreDeclaration<S, Scope> {
  /** Older homes the value is imported from once, in place of `from`. See `BuiltinStoreFrom`. */
  readonly builtinFrom?: BuiltinStoreFrom | readonly BuiltinStoreFrom[]
}

/**
 * Declares a built-in's window state, as `Store` does, with older homes that may be parts of shared app keys.
 *
 * @example
 * ```ts
 * stores: { seen: BuiltinStore.global(Seen, {}, "highlights.v1") }
 * ```
 */
export const BuiltinStore = {
  /**
   * One value for the app, as `Store.global`.
   *
   * @param schema - Decodes the stored JSON; an object schema.
   * @param initial - The value before anything is stored.
   * @param from - Older homes to import the value from once.
   */
  global: <S extends StoreDeclaration["schema"]>(
    schema: S,
    initial: NoInfer<S["Type"]>,
    from?: BuiltinStoreFrom | readonly BuiltinStoreFrom[],
  ): BuiltinStoreDeclaration<S, "global"> => ({ scope: "global", schema, initial, builtinFrom: from }),
  /**
   * One value per session, as `Store.session`.
   *
   * @param schema - Decodes the stored JSON; an object schema.
   * @param initial - The value before anything is stored.
   * @param from - Older homes to import the value from once; `{ key, sessions, pick }` reads one session's entry of a
   *   global key.
   */
  session: <S extends StoreDeclaration["schema"]>(
    schema: S,
    initial: NoInfer<S["Type"]>,
    from?: BuiltinStoreFrom | readonly BuiltinStoreFrom[],
  ): BuiltinStoreDeclaration<S, "session"> => ({ scope: "session", schema, initial, builtinFrom: from }),
}

/** What `BuiltinStorage.store` opens: `StoreOptions` whose older homes may be parts of shared app keys. */
export interface BuiltinStoreOptions<S extends Schema.ConstraintCodec<object, unknown>>
  extends Omit<StoreOptions<S>, "from"> {
  /** Older homes to import the value from once. See `BuiltinStoreFrom`. */
  readonly from?: BuiltinStoreFrom | readonly BuiltinStoreFrom[]
}

type WindowStorage = Context["storage"]

/** Window storage whose older homes may be parts of shared app keys. */
export interface BuiltinStorage extends WindowStorage {
  /**
   * Opens a store, as `Storage.store` does.
   *
   * @param key - The store's key in your namespace.
   * @param options - Its schema, initial value, scope and older homes.
   */
  store<S extends Schema.ConstraintCodec<object, unknown>>(
    key: string,
    options: BuiltinStoreOptions<S>,
  ): Persisted<S["Type"]>
  /**
   * Deletes the value, as `Storage.remove` does.
   *
   * @param key - The store's key in your namespace.
   * @param options - The store's scope and older homes.
   */
  remove(
    key: string,
    options?: {
      /** The store's scope. Defaults to `"global"`. */
      readonly scope?: StorageScope
      /** The store's `from`. */
      readonly from?: BuiltinStoreFrom | readonly BuiltinStoreFrom[]
    },
  ): void
}

/** `Desktop` with the abilities only built-ins use. */
export interface BuiltinDesktop extends Desktop {
  /**
   * Keeps the window focused for automation and debugging.
   *
   * @param enabled - Turns it on or off.
   */
  forceFocus(enabled: boolean): Promise<void>
}

/** `Layout` with the abilities only built-ins use. */
export interface BuiltinLayout extends Layout {
  /**
   * Runs an app command as the command palette does, e.g. `mcp.toggle` (the `/mcp` dialog). Does nothing when the
   * command is unavailable or disabled. App command ids are the app's own, not a plugin contract.
   *
   * @param id - The app command's id.
   */
  command(id: string): void
}

/** `Locale` with the abilities only built-ins use. */
export interface BuiltinLocale extends Locale {
  /**
   * Overrides the writing direction.
   *
   * @param direction - `ltr` or `rtl`.
   */
  setDirection(direction: "ltr" | "rtl"): void
}

/** The window context as the app's host builds it for every plugin, with the members only built-ins use. */
export interface BuiltinContext extends Context {
  /** Desktop-only abilities, `forceFocus` included; undefined on the web. */
  readonly desktop: BuiltinDesktop | undefined
  /** The interface language and its writing direction, which `setDirection` overrides. */
  readonly locale: BuiltinLocale
  /** The session layout, with `command`. */
  readonly layout: BuiltinLayout
  /** Stores whose older homes may be parts of shared app keys. */
  readonly storage: BuiltinStorage
}

/**
 * The members only built-ins use, on a window context from setup or `usePlugin()`.
 *
 * @param ctx - The plugin's context.
 * @returns The same object, typed with the built-in members.
 *
 * @example
 * ```ts
 * const locale = builtinContext(usePlugin()).locale
 * locale.setDirection(locale.direction() === "rtl" ? "ltr" : "rtl")
 * ```
 */
export function builtinContext(ctx: Context): BuiltinContext {
  // SAFETY: the app's window host builds every context as a `BuiltinContext` (its HostApi factories are typed by it),
  // and built-ins run only in that host.
  return ctx as BuiltinContext
}

/**
 * An older home of a built-in's main store value, imported once while the store holds nothing. Where `from` takes a
 * list, it names several, newest first, and the first that holds a value is imported. The older home keeps its copy
 * until the store is removed.
 * - `{ settings, file? }`: a key of a desktop settings file, the app's own unless `file` names another.
 * - `{ state }`: a key of another main storage namespace.
 *
 * @example
 * ```ts
 * builtinMainContext(ctx).storage.store("keepScreenActive", {
 *   schema: Schema.Boolean,
 *   initial: false,
 *   from: { state: ["opencode.settings", "keepScreenActive"] },
 * })
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

type MainStorage = MainContext["storage"]

/** Main storage with older homes a built-in's values are imported from once. */
export interface BuiltinMainStorage extends MainStorage {
  /**
   * Opens a store, as `Storage.store` does in main.
   *
   * @param key - The store's key in your namespace.
   * @param options - The store's options.
   */
  store<S extends Schema.ConstraintCodec<unknown, unknown>>(
    key: string,
    options: {
      /** Decodes the stored JSON; any schema. */
      readonly schema: S
      /** The value before anything is stored, and after `remove`. */
      readonly initial: S["Type"]
      /** Older homes to import the value from once, while the key holds nothing. See `MainStoreFrom`. */
      readonly from?: MainStoreFrom | readonly MainStoreFrom[]
    },
  ): Persisted<S["Type"], S["Type"]>
  /**
   * Deletes the value, so opening the key again reads its `initial`. Pass the store's `from`: every older home it names
   * is deleted too, so none is imported again.
   *
   * @param key - The store's key in your namespace.
   * @param options - The store's options.
   */
  remove(
    key: string,
    options?: {
      /** The store's `from`. */
      readonly from?: MainStoreFrom | readonly MainStoreFrom[]
    },
  ): void
}

/** The app process's lifetime. */
export interface Lifecycle {
  /**
   * Marks the app as quitting and disposes every plugin but the caller, then runs handoff (e.g. quitAndInstall) or
   * relaunches. The caller outlives shutdown until the handoff settles, and keeps running when it fails (the promise
   * rejects).
   *
   * @param handoff - Runs once the others are disposed; omit it to relaunch.
   *
   * @example
   * ```ts
   * await builtinMainContext(ctx).lifecycle.restart(() => updater.quitAndInstall())
   * ```
   */
  restart(handoff?: () => void | Promise<void>): Promise<void>
}

/** The main context as the desktop host builds it for every plugin, with the members only built-ins use. */
export interface BuiltinMainContext extends MainContext {
  /** Synchronous storage whose stores may import older homes. */
  readonly storage: BuiltinMainStorage
  /** Restarts the app, keeping this plugin through a handoff. */
  readonly lifecycle: Lifecycle
}

/**
 * The members only built-ins use, on a main context.
 *
 * @param ctx - The plugin's main context.
 * @returns The same object, typed with the built-in members.
 *
 * @example
 * ```ts
 * const lifecycle = builtinMainContext(ctx).lifecycle
 * ```
 */
export function builtinMainContext(ctx: MainContext): BuiltinMainContext {
  // SAFETY: the desktop host builds every main context as a `BuiltinMainContext` (it types the context it builds by
  // it), and built-ins run only in that host.
  return ctx as BuiltinMainContext
}

/**
 * A built-in's copy by locale: English inline, and other locales inline or as a loader the host calls when the user
 * picks that locale, so a built-in's translations load only when used. A loader that fails leaves English.
 *
 * @example
 * ```ts
 * i18n: builtinCatalog({ en, de: () => import("./i18n/de") })
 * ```
 */
export type BuiltinCatalog = {
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
 * Declares a built-in's catalog with lazily loaded locales. Both hosts load a locale's loader when the user picks it;
 * a plugin bundle's catalog is checked to be inline.
 *
 * @param catalog - English inline, other locales inline or as loaders.
 * @returns The catalog, as `Plugin.define` takes it.
 */
export function builtinCatalog(catalog: BuiltinCatalog): Catalog {
  // SAFETY: both hosts read a catalog as `BuiltinCatalog` and call a locale's loader; only built-ins pass one.
  return catalog as Catalog
}
