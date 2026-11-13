import { Schema } from "effect"
import type { Extension, WebContents, WebFrameMain } from "electron"

/**
 * One `chrome.*` namespace the profile adds to extension contexts, by its dotted path (`privacy.network.x` is
 * `chrome.privacy.network.x`). The preload builds it from this description: each method calls main with its
 * arguments, a trailing callback included, and each event is an object with `addListener`.
 * - `permissions`: the namespace exists only for an extension that declares one of these; every extension when empty.
 * - `manifest`: only for extensions of this manifest version.
 * - `sync`: methods that also return their first argument's `id` at once, as `contextMenus.create` returns the id.
 * - `constants`: plain values set on the namespace, such as `windows.WINDOW_ID_CURRENT`.
 *
 * A namespace Chromium already has keeps its other members: the listed ones replace its own.
 */
export type ApiNamespace = {
  readonly path: string
  readonly permissions?: readonly string[]
  readonly manifest?: 2 | 3
  readonly methods: readonly string[]
  readonly events?: readonly string[]
  readonly sync?: readonly string[]
  readonly constants?: Readonly<Record<string, string | number | Readonly<Record<string, string | number>>>>
}

/** A value that crosses between an extension context and main: what structured clone keeps of plain data. */
export type Wire =
  | string
  | number
  | boolean
  | null
  | undefined
  | Uint8Array
  | readonly Wire[]
  | { readonly [key: string]: Wire }

/**
 * Who called: an installed extension of the profile, from one of its pages (`contents`, `frame`) or from its
 * background service worker (neither). Web pages and content scripts never reach main this way.
 */
export type ExtensionContext = {
  readonly extension: Extension
  readonly contents?: WebContents
  readonly frame?: WebFrameMain
}

/** A method's implementation, called with the arguments as the extension passed them, its callback left out. */
export type ApiMethod = (context: ExtensionContext, args: readonly Wire[]) => Wire | void | Promise<Wire | void>

/** Declares a method whose arguments decode with `args`; arguments that do not decode reject the call. */
export function method<const A>(
  args: Schema.Decoder<A>,
  run: (context: ExtensionContext, args: A) => Wire | void | Promise<Wire | void>,
): ApiMethod {
  const decode = Schema.decodeUnknownSync(args)

  return (context, input) => run(context, decode(input))
}

/** A method whose answer does not depend on its arguments, for APIs this browser has nothing behind. */
export function constant(value: Wire): ApiMethod {
  return () => value
}

/**
 * What one API module adds: the namespaces it exposes and the methods behind them, by `path.method`. `forget` drops
 * what an extension set up while it ran, as when it is turned off or removed.
 */
export type ApiModule = {
  readonly namespaces: readonly ApiNamespace[]
  readonly methods: Readonly<Record<string, ApiMethod>>
  readonly forget?: (extension: string) => void
  readonly dispose?: () => void
}

/** Sends `event` (`path.onSomething`) with `args` to the extensions that listen, or only to `extension`. */
export type Emit = (event: string, args: readonly Wire[], extension?: string) => void

/** An argument callers may leave out or pass as `null`. */
export const optional = <S extends Schema.Top>(schema: S) => Schema.optional(Schema.NullOr(schema))

/** The arguments of a method that reads none. */
export const none = Schema.Array(Schema.Unknown)
