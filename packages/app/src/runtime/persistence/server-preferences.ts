import { isUnauthorizedError } from "@opencode/client/promise"
import { Option, Predicate, Schema } from "effect"
import { createApiForServer, type ServerApi } from "@/runtime/server/api"
import { ServerState } from "@/runtime/server/persistence"
import { createNamespaceStorage, type NamespaceDriver, type NamespaceStorage } from "./namespace"
import { flushPersisted } from "./persist"
import {
  DEFAULT_PREFERENCES,
  GLOBAL_PREFERENCES,
  INITIAL_SERVER_PREFERENCES_STATE,
  PREFERENCE_NAMESPACES,
  selectMirrorServer,
  syncsPreference,
  transitionServerPreferences,
  type PreferenceChange,
  type PreferenceServer,
  type ServerPreferencesEffect,
  type ServerPreferencesEvent,
} from "./server-preferences-machine"

// The first render waits for the server's copy; a server that does not answer in time leaves the page on its own.
const HYDRATE_TIMEOUT_MS = 1_500

// Browsers reject a keepalive request once the keepalive bodies in flight pass 64 KiB, so only updates up to half that
// ask to outlive the page, leaving room for the other namespace's.
const KEEPALIVE_MAX_BYTES = 32 * 1024

const decodeServers = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ list: ServerState.fields.list })),
)

let state = INITIAL_SERVER_PREFERENCES_STATE

// Edge handles only: the load the first render waits on, and the namespaces that batch writes for the server.
let hydration = Promise.resolve()

const namespaces = new Map<string, NamespaceStorage>()

const driver: NamespaceDriver = {
  // The server keeps no revisions. This page takes no changes from elsewhere while it runs, so the namespace never
  // compares them.
  items: (name) =>
    mirror((api) => api.experimental.preference.items({ name })).then((items) => ({ items, revision: 0 })),
  update: (name, insert, remove) =>
    mirror((api) => api.experimental.preference.update({ name, insert, remove })).then(() => 0),
  clear: (name) => mirror((api) => api.experimental.preference.clear({ name })),
}

// Bun's fetch type carries preconnect; the browser never calls it.
const keepaliveFetch = Object.assign(
  (input: RequestInfo | URL, init?: RequestInit) => {
    const body = init?.body

    return fetch(input, {
      ...init,
      keepalive: Predicate.isString(body) && new Blob([body]).size <= KEEPALIVE_MAX_BYTES,
    })
  },
  { preconnect: () => {} },
)

/**
 * Loads the server's copy of the preferences into `localStorage`. Resolves once it is there, or once the page keeps
 * its own because the server cannot hold them, refused the password, or did not answer in time.
 */
export function hydrateServerPreferences(server: PreferenceServer) {
  dispatch({
    type: "hydrate.started",
    server: { url: server.url, password: storedPassword(server.url) ?? server.password },
  })

  return hydration
}

/** The server accepts the app's password: a sign-in after a refused one loads the server's copy. */
export function serverPreferencesSignedIn(password: string | undefined) {
  dispatch({ type: "signed-in", password })
}

/** Records a `localStorage` write of a storage namespace (the default one when `undefined`) for the server. */
export function recordPreference(storage: string | undefined, key: string, value: string | null) {
  const name = storage ?? DEFAULT_PREFERENCES

  if (syncsPreference(name, key)) dispatch({ type: "written", change: { name, key, value } })
}

function dispatch(event: ServerPreferencesEvent) {
  const next = transitionServerPreferences(state, event)
  state = next.state
  next.effects.forEach(execute)
}

function execute(effect: ServerPreferencesEffect) {
  if (effect.type === "load") {
    hydration = load(effect.server)

    return
  }

  if (effect.type === "store") return effect.changes.forEach(store)

  if (effect.type === "send") return effect.changes.forEach(send)

  // Hiding the page writes every store with unsaved changes first, such as a server list that just signed in.
  location.reload()
}

function load(server: PreferenceServer) {
  const api = createApiForServer({ server })
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), HYDRATE_TIMEOUT_MS)

  return Promise.all(
    PREFERENCE_NAMESPACES.map((name) =>
      api.experimental.preference
        .items({ name }, { signal: controller.signal })
        .then((items) => [name, items] as const),
    ),
  )
    .then((stored) => ({ stored: Object.fromEntries(stored), local: readLocal() }))
    .then(
      (loaded) => dispatch({ type: "hydrate.succeeded", stored: loaded.stored, local: loaded.local }),
      (error) => dispatch({ type: "hydrate.failed", unauthorized: isUnauthorizedError(error) }),
    )
    .finally(() => clearTimeout(timer))
}

// This browser's synced values: the global namespace's prefixed keys and the default namespace's unprefixed ones.
function readLocal() {
  const stored = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index) ?? "")

  return Object.fromEntries(
    PREFERENCE_NAMESPACES.map((name) => [
      name,
      Object.fromEntries(
        stored.flatMap((item) => {
          const key = item.slice(prefix(name).length)

          if (!item.startsWith(prefix(name)) || !syncsPreference(name, key)) return []
          const value = localStorage.getItem(item)

          return value === null ? [] : [[key, value]]
        }),
      ),
    ]),
  )
}

// Bypasses the app's storage view, so the value is not sent back and a full storage evicts nothing for it. A value
// that does not fit stays as it was; the next load stores it again.
function store(change: PreferenceChange) {
  const key = prefix(change.name) + change.key

  try {
    if (change.value === null) return localStorage.removeItem(key)

    localStorage.setItem(key, change.value)
  } catch {}
}

function send(change: PreferenceChange) {
  const namespace = namespaces.get(change.name) ?? createNamespaceStorage(driver, change.name)
  namespaces.set(change.name, namespace)
  void (change.value === null ? namespace.removeItem(change.key) : namespace.setItem(change.key, change.value))
}

// Requests go to the server writes go to now, so a retry after a sign-in carries the new password.
function mirror<T>(call: (api: ServerApi) => Promise<T>) {
  const server = selectMirrorServer(state)

  if (!server) return Promise.reject(new Error("Preferences are not mirrored to a server"))

  return call(createApiForServer({ server, fetch: keepaliveFetch }))
}

// The app signs in with the saved server's password before the one in the URL, as `resolveServerList` merges them.
function storedPassword(url: string) {
  try {
    return Option.getOrUndefined(decodeServers(localStorage.getItem(`${GLOBAL_PREFERENCES}:server`)))?.list.find(
      (conn) => conn.http.url === url,
    )?.http.password
  } catch {
    return undefined
  }
}

function prefix(name: string) {
  return name === DEFAULT_PREFERENCES ? "" : `${name}:`
}

// Writes queued for the server go out before the page goes away or leaves the foreground, as on desktop. Stores with
// unsaved changes write to `localStorage` first, which queues them here.
function flush() {
  flushPersisted()
  namespaces.forEach((namespace) => void namespace.flush())
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush()
  })
  window.addEventListener("pagehide", flush)
}
