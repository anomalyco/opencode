import { Context, Effect, Layer } from "effect"
import { Database } from "../database/database"
import { PersonalApiConnectionsTable } from "./sql"
import { eq } from "drizzle-orm"
import { Identifier } from "../util/identifier"

export interface ApiConnection {
  id: string
  name: string
  base_url: string
  auth_type: string
  auth_value: string | null
  headers: Record<string, string> | null
  time_created: number
  time_updated: number
}

export interface Interface {
  readonly get: (connectionId: string, path: string, query?: Record<string, string>) => Effect.Effect<any>
  readonly post: (connectionId: string, path: string, body?: any) => Effect.Effect<any>
  readonly put: (connectionId: string, path: string, body?: any) => Effect.Effect<any>
  readonly delete: (connectionId: string, path: string) => Effect.Effect<any>
  readonly saveConnection: (name: string, baseUrl: string, authType: string, authValue?: string) => Effect.Effect<ApiConnection>
  readonly listConnections: () => Effect.Effect<ApiConnection[]>
  readonly deleteConnection: (id: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/API") {}

function buildHeaders(conn: any): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (conn.headers) {
    try {
      Object.assign(headers, JSON.parse(conn.headers))
    } catch {}
  }
  if (conn.auth_type === "bearer" && conn.auth_value) {
    headers["Authorization"] = `Bearer ${conn.auth_value}`
  } else if (conn.auth_type === "basic" && conn.auth_value) {
    headers["Authorization"] = `Basic ${conn.auth_value}`
  } else if (conn.auth_type === "api_key" && conn.auth_value) {
    headers["X-API-Key"] = conn.auth_value
  }
  return headers
}

function parseConnectionRow(row: any): ApiConnection {
  let headers: Record<string, string> | null = null
  try {
    headers = row.headers ? JSON.parse(row.headers) : null
  } catch {}
  return {
    id: row.id,
    name: row.name,
    base_url: row.base_url,
    auth_type: row.auth_type ?? "none",
    auth_value: row.auth_value,
    headers,
    time_created: row.time_created,
    time_updated: row.time_updated,
  }
}

function request(
  conn: any,
  method: string,
  path: string,
  body?: any,
  query?: Record<string, string>,
): Effect.Effect<any> {
  return Effect.gen(function* () {
    const headers = buildHeaders(conn)
    const qs = query ? "?" + new URLSearchParams(query).toString() : ""
    const baseUrl = conn.base_url.replace(/\/$/, "")
    const cleanPath = path.replace(/^\//, "")
    const url = baseUrl + "/" + cleanPath + qs
    const opts: RequestInit = { method, headers }
    if (body) opts.body = JSON.stringify(body)
    const res = yield* Effect.tryPromise(() => fetch(url, opts))
    if (!res.ok) return yield* Effect.fail(new Error(`HTTP ${res.status}: ${res.statusText}`))
    return yield* Effect.tryPromise(() => res.json())
  })
}

export const layer = Layer.effect(Service, Effect.gen(function* () {
  const { db } = yield* Database.Service
  return Service.of({
    get: (connectionId, path, query) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select()
          .from(PersonalApiConnectionsTable)
          .where(eq(PersonalApiConnectionsTable.id, connectionId))
          .all()
          .pipe(Effect.orDie)
        if (rows.length === 0)
          return yield* Effect.fail(new Error("Connection not found"))
        return yield* request(rows[0], "GET", path, undefined, query)
      }),
    post: (connectionId, path, body) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select()
          .from(PersonalApiConnectionsTable)
          .where(eq(PersonalApiConnectionsTable.id, connectionId))
          .all()
          .pipe(Effect.orDie)
        if (rows.length === 0)
          return yield* Effect.fail(new Error("Connection not found"))
        return yield* request(rows[0], "POST", path, body)
      }),
    put: (connectionId, path, body) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select()
          .from(PersonalApiConnectionsTable)
          .where(eq(PersonalApiConnectionsTable.id, connectionId))
          .all()
          .pipe(Effect.orDie)
        if (rows.length === 0)
          return yield* Effect.fail(new Error("Connection not found"))
        return yield* request(rows[0], "PUT", path, body)
      }),
    delete: (connectionId, path) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select()
          .from(PersonalApiConnectionsTable)
          .where(eq(PersonalApiConnectionsTable.id, connectionId))
          .all()
          .pipe(Effect.orDie)
        if (rows.length === 0)
          return yield* Effect.fail(new Error("Connection not found"))
        return yield* request(rows[0], "DELETE", path)
      }),
    saveConnection: (name, baseUrl, authType, authValue) =>
      Effect.gen(function* () {
        const id = "api_" + Identifier.ascending()
        const now = Date.now()
        const row = {
          id,
          name,
          base_url: baseUrl,
          auth_type: authType,
          auth_value: authValue ?? null,
          headers: null,
          time_created: now,
          time_updated: now,
        }
        yield* db.insert(PersonalApiConnectionsTable).values(row).pipe(Effect.orDie)
        return parseConnectionRow(row)
      }),
    listConnections: Effect.gen(function* () {
      const rows = yield* db
        .select()
        .from(PersonalApiConnectionsTable)
        .all()
        .pipe(Effect.orDie)
      return rows.map(parseConnectionRow)
    }),
    deleteConnection: (id) =>
      Effect.gen(function* () {
        yield* db
          .delete(PersonalApiConnectionsTable)
          .where(eq(PersonalApiConnectionsTable.id, id))
          .run()
          .pipe(Effect.orDie)
      }),
  })
}))

export const defaultLayer = layer.pipe(Layer.provide(Database.defaultLayer))

export { Service as API }
