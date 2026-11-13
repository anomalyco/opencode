import { Schema } from "effect"
import type { Extension, WebContents, WebFrameMain } from "electron"
import type { ApiManifest } from "./manifest"

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

/** Carry API errors as data: Electron otherwise adds the IPC channel name to the extension's error message. */
export function apiReply(call: Promise<Wire | void>) {
  return call.then(
    (value) => ({ ok: true, value }) as const,
    (cause: unknown) => ({ ok: false, message: cause instanceof Error ? cause.message : String(cause) }) as const,
  )
}

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

/** The namespace a `path.member` name belongs to: the one whose path is everything before the member. */
export function namespaceOf(namespaces: readonly ApiNamespace[], name: string) {
  return namespaces.find(
    (namespace) => name.startsWith(`${namespace.path}.`) && !name.slice(namespace.path.length + 1).includes("."),
  )
}

/**
 * Whether an extension may use a namespace: the trust check before every call and subscription. Its manifest version
 * must match the namespace's, and it must declare one of the namespace's permissions when the namespace names any.
 */
export function allowed(manifest: ApiManifest, namespace: ApiNamespace | undefined) {
  if (!namespace) return false

  if (namespace.manifest && namespace.manifest !== manifest.version) return false

  return !namespace.permissions?.length || namespace.permissions.some((item) => manifest.permissions.includes(item))
}

/** An argument callers may leave out or pass as `null`. */
export const optional = <S extends Schema.Top>(schema: S) => Schema.optional(Schema.NullOr(schema))

/** The arguments of a method that reads none. */
export const none = Schema.Array(Schema.Unknown)
