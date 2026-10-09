import type { Data } from "@opencode/client/solid"
import type { LocationRef } from "@opencode/client/promise"
import type { ServerSDK } from "@/runtime/server/client"

const loading = new WeakMap<ServerSDK, Promise<LocationRef[]>>()

// This inventory reads existing location services without acquiring a location.
// Share concurrent reads, but never retain a snapshot across reconnects or later
// location creation. Failure must not fall back to historical session locations.
export function loadedLocations(sdk: ServerSDK) {
  const pending = loading.get(sdk)
  if (pending) return pending
  const next = sdk.api.location.list().finally(() => {
    if (loading.get(sdk) === next) loading.delete(sdk)
  })
  loading.set(sdk, next)
  return next
}

function directory(value: string) {
  if (!/^[a-z]:[\\/]/i.test(value)) return value
  return value
    .replace(/[\\/]+/g, "/")
    .replace(/\/$/, "")
    .toLowerCase()
}

function sameLocation(a: LocationRef, b: LocationRef) {
  // Session endpoints resolve the full stored location, including workspaceID.
  return directory(a.directory) === directory(b.directory) && a.workspaceID === b.workspaceID
}

export async function permissionLocations(input: { sdk: ServerSDK; data: Data; current: () => boolean }) {
  const [active, loaded] = await Promise.all([
    input.sdk.api.session.active().catch(() => undefined),
    loadedLocations(input.sdk).catch(() => undefined),
  ])
  if (!input.current()) return { locations: [], complete: true }
  const ids = Object.keys(active ?? {})
  // A session can move while disconnected. Failed refreshes must not acquire
  // the old location from cached metadata.
  const synced = await Promise.all(
    ids.map((id) => {
      input.data.session.invalidate(id)
      return input.data.session.sync(id).then(
        () => true,
        () => false,
      )
    }),
  )
  if (!input.current()) return { locations: [], complete: true }
  const locations: LocationRef[] = [
    ...ids.flatMap((id, index) => {
      if (!synced[index]) return []
      const location = input.data.session.get(id)?.location
      return location ? [location] : []
    }),
    ...(loaded ?? []),
  ]
  return {
    locations: [
      ...new Map(locations.map((item) => [JSON.stringify([item.directory, item.workspaceID]), item])).values(),
    ],
    complete: active !== undefined && loaded !== undefined && synced.every(Boolean),
  }
}

export async function syncInactiveSession(input: { sdk: ServerSDK; data: Data; id: string; current: () => boolean }) {
  // Metadata and the durable inbox are process-global. Permissions and forms
  // acquire location services, which can start MCP servers and file watchers.
  await Promise.all([input.data.session.sync(input.id, { children: true }), input.data.session.pending.sync(input.id)])
  if (!input.current()) return
  const session = input.data.session.get(input.id)
  if (!session) return
  const running = [input.id, ...input.data.session.family(input.id)].some(
    (id) => input.data.session.status(id) === "running",
  )
  const pending = input.data.session.pending.list(input.id).some((item) => item.type !== "synthetic")
  if (!running && !pending) {
    const locations = await loadedLocations(input.sdk)
    if (!input.current() || !locations.some((location) => sameLocation(location, session.location))) return
  }
  await Promise.all([input.data.session.permission.sync(input.id), input.data.session.form.sync(input.id)])
}
