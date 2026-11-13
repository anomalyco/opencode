// The browser profile's preload, for every frame and service worker of its partition. In the pages and background
// worker of an installed extension it adds the chrome.* namespaces main implements; anywhere else, such as a web
// page or a site's own service worker, it does nothing. Main writes the namespace list in place of the marker.
const { contextBridge, ipcRenderer } = require("electron")

const namespaces = JSON.parse("__NAMESPACES__")

// Manifest V2 background pages run without context isolation, so this shares their world.
const isolated = process.contextIsolated !== false

// A service worker's preload sees no `location` of its own; its main world does.
const href = String(
  globalThis.location?.href ??
    (isolated ? contextBridge.executeInMainWorld({ func: () => String(globalThis.location?.href) }) : ""),
)

if (href.startsWith("chrome-extension://")) {
  const receiver = { dispatch: undefined }
  ipcRenderer.on("browser-extension:event", (_event, name, args) => receiver.dispatch?.(name, args))
  // Main attaches a worker's handlers as it starts, which can land just after the worker's first calls. Each retry
  // waits a round trip to main; a worker's preload has no timers.
  const request = (channel, args, attempt = 0) =>
    ipcRenderer.invoke(channel, ...args).catch((error) => {
      if (attempt >= 200 || !String(error?.message).includes("No handler registered")) throw error
      return request(channel, args, attempt + 1)
    })
  const bridge = {
    invoke: (name, args) => request("browser-extension:call", [name, args]),
    subscribe: (name) => void request("browser-extension:subscribe", [name]).catch(() => undefined),
    listen: (dispatch) => {
      receiver.dispatch = dispatch
    },
  }
  if (isolated) contextBridge.executeInMainWorld({ func: install, args: [namespaces, bridge] })
  else install(namespaces, bridge)
}

// Runs in the extension's own world, so it must not use anything from this file's scope.
function install(namespaces, bridge) {
  const chrome = globalThis.chrome
  if (!chrome?.runtime?.getManifest) return
  const manifest = chrome.runtime.getManifest()
  // Only hides namespaces the extension cannot use; main's `allowed` is the check that refuses a call.
  const declared = new Set([...(manifest.permissions ?? []), ...(manifest.host_permissions ?? [])])
  const listeners = new Map()

  bridge.listen((name, args) => {
    for (const listener of [...(listeners.get(name) ?? [])]) {
      try {
        listener(...args)
      } catch (error) {
        console.error(error)
      }
    }
  })

  const event = (name) => ({
    addListener(listener) {
      const set = listeners.get(name) ?? new Set()
      if (set.size === 0) bridge.subscribe(name)
      set.add(listener)
      listeners.set(name, set)
    },
    removeListener(listener) {
      listeners.get(name)?.delete(listener)
    },
    hasListener(listener) {
      return listeners.get(name)?.has(listener) ?? false
    },
    hasListeners() {
      return (listeners.get(name)?.size ?? 0) > 0
    },
  })

  // ImageData and other host objects become plain data; functions and undefined drop out.
  const clean = (value) => {
    if (typeof ImageData !== "undefined" && value instanceof ImageData)
      return { width: value.width, height: value.height, data: new Uint8Array(value.data) }
    if (Array.isArray(value)) return value.map(clean)
    if (value && typeof value === "object" && !(value instanceof ArrayBuffer) && !ArrayBuffer.isView(value))
      return Object.fromEntries(
        Object.entries(value)
          .filter((entry) => typeof entry[1] !== "function" && entry[1] !== undefined)
          .map((entry) => [entry[0], clean(entry[1])]),
      )
    return typeof value === "function" ? undefined : value
  }

  const call = (name, sync) =>
    function (...args) {
      const callback = typeof args.at(-1) === "function" ? args.pop() : undefined
      if (sync && args[0] && typeof args[0] === "object" && args[0].id === undefined)
        args[0] = { ...args[0], id: crypto.randomUUID() }
      const id = sync ? args[0]?.id : undefined
      const result = bridge.invoke(name, clean(args))
      if (!callback) return sync ? id : result
      result.then(
        (value) => callback(value),
        (error) => {
          console.error(`chrome.${name}: ${error?.message ?? error}`)
          callback()
        },
      )
      return id
    }

  const define = (target, key, value) => {
    try {
      Object.defineProperty(target, key, { value, configurable: true, enumerable: true, writable: true })
    } catch (error) {
      console.error(`chrome.${key}: ${error?.message ?? error}`)
    }
  }

  // Chromium also gives extensions a `browser` object of its own, which code such as uBlock Origin Lite reads first.
  const roots = [...new Set([chrome, globalThis.browser].filter(Boolean))]

  for (const namespace of namespaces) {
    if (namespace.manifest && namespace.manifest !== manifest.manifest_version) continue
    if (namespace.permissions?.length && !namespace.permissions.some((permission) => declared.has(permission))) continue
    const members = Object.fromEntries([
      ...namespace.methods.map((name) => [name, call(`${namespace.path}.${name}`, namespace.sync?.includes(name))]),
      ...(namespace.events ?? []).map((name) => [name, event(`${namespace.path}.${name}`)]),
      ...Object.entries(namespace.constants ?? {}),
    ])
    for (const root of roots) {
      const target = namespace.path.split(".").reduce((parent, key) => {
        if (!parent[key]) define(parent, key, {})
        return parent[key]
      }, root)
      for (const [name, value] of Object.entries(members)) define(target, name, value)
    }
  }
}
