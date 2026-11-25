/** The global storage namespace: the `localStorage` keys prefixed `opencode.global.dat:`. */
export const GLOBAL_PREFERENCES = "opencode.global.dat"

/** The default storage namespace, by desktop's name for it: unprefixed `localStorage` keys. */
export const DEFAULT_PREFERENCES = "default.dat"

export const PREFERENCE_NAMESPACES = [GLOBAL_PREFERENCES, DEFAULT_PREFERENCES] as const

const GLOBAL_KEYS = new Set(["language"])

const DEFAULT_KEYS = new Set(["settings.v3", "opencode-theme-id", "opencode-color-scheme"])

/**
 * Whether a stored key follows the user to the server: only the preferences listed above, which hold no server's
 * data. Every other key stays in the browser, including keys added later: the server list (credentials and this
 * browser's connections), data kept for each server, plugin stores, layout, tab and session state, caches, and
 * window, workspace and draft storage.
 */
export function syncsPreference(name: string, key: string) {
  if (name === GLOBAL_PREFERENCES) return GLOBAL_KEYS.has(key)

  return name === DEFAULT_PREFERENCES && DEFAULT_KEYS.has(key)
}

export type PreferenceServer = { readonly url: string; readonly password: string | undefined }

/** One stored key of one namespace; `null` deletes it. */
export type PreferenceChange = { readonly name: string; readonly key: string; readonly value: string | null }

/** Stored values by namespace, then by key. */
export type PreferenceItems = Readonly<Record<string, Readonly<Record<string, string>>>>

/**
 * Where the web app's preferences live. `localStorage` stays the synchronous source for the app; the server's copy is
 * loaded into it, and later writes are sent back.
 *
 * - `local`: only in this browser. The start, and the end of every path where the server cannot keep them: it is
 *   disabled, too old, unreachable or too slow, or the page reloads to show the server's copy.
 * - `hydrating`: the server's copy is loading. `mounted` once the app rendered, so a copy that differs needs a reload.
 * - `signed-out`: the server refused `server.password`; a sign-in with another one loads again.
 * - `mirroring`: every write is sent to the server.
 */
export type ServerPreferencesState =
  | { readonly status: "local" }
  | { readonly status: "hydrating"; readonly server: PreferenceServer; readonly mounted: boolean }
  | { readonly status: "signed-out"; readonly server: PreferenceServer }
  | { readonly status: "mirroring"; readonly server: PreferenceServer }

export type ServerPreferencesEvent =
  | { readonly type: "hydrate.started"; readonly server: PreferenceServer }
  /** `local` holds this browser's synced values when the server's answer arrived. */
  | { readonly type: "hydrate.succeeded"; readonly stored: PreferenceItems; readonly local: PreferenceItems }
  | { readonly type: "hydrate.failed"; readonly unauthorized: boolean }
  | { readonly type: "written"; readonly change: PreferenceChange }
  /** The server accepts the app's password, which may differ from the one these preferences last used. */
  | { readonly type: "signed-in"; readonly password: string | undefined }

export type ServerPreferencesEffect =
  | { readonly type: "load"; readonly server: PreferenceServer }
  /** Writes server values into `localStorage` without sending them back. */
  | { readonly type: "store"; readonly changes: readonly PreferenceChange[] }
  | { readonly type: "send"; readonly changes: readonly PreferenceChange[] }
  | { readonly type: "reload" }

export type ServerPreferencesTransition = {
  readonly state: ServerPreferencesState
  readonly effects: readonly ServerPreferencesEffect[]
}

export const INITIAL_SERVER_PREFERENCES_STATE: ServerPreferencesState = Object.freeze({ status: "local" })

// Forward-only: each result is matched on the phase that asked for it, so no attempt ids are needed.
export function transitionServerPreferences(
  state: ServerPreferencesState,
  event: ServerPreferencesEvent,
): ServerPreferencesTransition {
  if (event.type === "hydrate.started") {
    if (state.status !== "local") return unchanged(state)

    return {
      state: { status: "hydrating", server: event.server, mounted: false },
      effects: [{ type: "load", server: event.server }],
    }
  }

  if (event.type === "written") {
    if (state.status !== "mirroring") return unchanged(state)

    return { state, effects: [{ type: "send", changes: [event.change] }] }
  }

  if (event.type === "signed-in") {
    if (state.status !== "signed-out" && state.status !== "mirroring") return unchanged(state)

    if (state.server.password === event.password) return unchanged(state)
    const server = { url: state.server.url, password: event.password }

    // Writes still queued, and their retries, go out with the new password.
    if (state.status === "mirroring") return { state: { status: "mirroring", server }, effects: [] }

    return { state: { status: "hydrating", server, mounted: true }, effects: [{ type: "load", server }] }
  }

  if (state.status !== "hydrating") return unchanged(state)

  if (event.type === "hydrate.failed") {
    if (event.unauthorized) return { state: { status: "signed-out", server: state.server }, effects: [] }

    return { state: INITIAL_SERVER_PREFERENCES_STATE, effects: [] }
  }

  // The server wins for every key it holds, and keys only this browser holds are uploaded; nothing is deleted. Stored
  // keys pass `syncsPreference` here too, so no server can write this browser's server list or any other unlisted key.
  const store = entries(event.stored).filter(
    (entry) => syncsPreference(entry.name, entry.key) && event.local[entry.name]?.[entry.key] !== entry.value,
  )

  const send = entries(event.local).filter((entry) => !Object.hasOwn(event.stored[entry.name] ?? {}, entry.key))

  // The rendered app read the values it now shows, so it reloads to read the server's; the reloaded page loads again.
  if (state.mounted && store.length > 0) {
    return { state: INITIAL_SERVER_PREFERENCES_STATE, effects: [{ type: "store", changes: store }, { type: "reload" }] }
  }

  return {
    state: { status: "mirroring", server: state.server },
    effects: [
      ...(store.length > 0 ? [{ type: "store", changes: store } as const] : []),
      ...(send.length > 0 ? [{ type: "send", changes: send } as const] : []),
    ],
  }
}

/** The server that writes go to, while they go to one. */
export function selectMirrorServer(state: ServerPreferencesState) {
  return state.status === "mirroring" ? state.server : undefined
}

function entries(items: PreferenceItems) {
  return Object.entries(items).flatMap(([name, values]) =>
    Object.entries(values).map(([key, value]): PreferenceChange => ({ name, key, value })),
  )
}

function unchanged(state: ServerPreferencesState): ServerPreferencesTransition {
  return { state, effects: [] }
}
