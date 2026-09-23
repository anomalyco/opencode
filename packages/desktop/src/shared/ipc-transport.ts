export const IpcTransportPort = "desktop-rpc-port"
export const DragCancelEvent = "opencode:drag-cancel"
export const StorageSnapshotChannel = "desktop-storage-snapshot"

// The main process decodes RPC payloads with the JSON codec, and JSON has no undefined: an
// optional field the caller left as `undefined` decodes only when its key is absent. Structured
// clone keeps the key, so drop such fields the way JSON.stringify would, leaving bytes untouched.
export function omitUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(omitUndefined)
  if (typeof value !== "object" || value === null || value instanceof Uint8Array) return value
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, item]) => (item === undefined ? [] : [[key, omitUndefined(item)]])),
  )
}

export type StorageSnapshot = Record<string, { items: Record<string, string>; revision: number }>

// The namespaces a window reads while its shell mounts. The preload asks for them before the page
// runs so the first render already has them; mirrors windowStorage() in
// packages/app/src/runtime/persistence/storage.ts.
export function storageSnapshotNames(windowID: string) {
  return ["opencode.global.dat", "default.dat", windowDataFile(windowID)]
}

export function windowDataFile(id: string) {
  return `opencode.window.${id.replace(/[^a-zA-Z0-9._-]/g, "-")}.dat`
}
