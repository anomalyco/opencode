export const IpcTransportPort = "desktop-rpc-port"
export const DragCancelEvent = "opencode:drag-cancel"
export const StorageSnapshotChannel = "desktop-storage-snapshot"

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
