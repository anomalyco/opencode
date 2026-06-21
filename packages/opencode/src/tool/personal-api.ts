import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./personal-api.txt"

export const HttpMethod = Schema.Literal("GET", "POST", "PUT", "DELETE")

export const Parameters = Schema.Struct({
  action: Schema.Literal("request", "save_connection", "list_connections"),
  method: Schema.optional(HttpMethod),
  url: Schema.optional(Schema.String),
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  body: Schema.optional(Schema.String),
  connection_id: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  base_url: Schema.optional(Schema.String),
  auth_type: Schema.optional(Schema.String),
  auth_value: Schema.optional(Schema.String),
})

export const PersonalApiTool = Tool.define(
  "personal_api",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const { API } = yield* Effect.promise(() => import("@opencode-ai/core/personal/api"))
          const svc = yield* API

          switch (params.action) {
            case "request": {
              if (!params.url) return yield* Effect.fail(new Error("url is required for request action"))
              const method = params.method ?? "GET"
              if (params.connection_id) {
                const result = yield* (method === "GET" ? svc.get(params.connection_id, params.url) :
                  method === "POST" ? svc.post(params.connection_id, params.url, params.body ? JSON.parse(params.body) : undefined) :
                  method === "PUT" ? svc.put(params.connection_id, params.url, params.body ? JSON.parse(params.body) : undefined) :
                  svc.delete(params.connection_id, params.url))
                return { title: `API ${method} via ${params.connection_id}`, output: JSON.stringify(result, null, 2) }
              } else {
                const headers: Record<string, string> = params.headers ?? {}
                const body = params.body ? JSON.parse(params.body) : undefined
                const res = yield* Effect.tryPromise(() => fetch(params.url!, { method, headers, body: body ? JSON.stringify(body) : undefined }))
                const result = yield* Effect.tryPromise(() => res.json())
                return { title: `API ${method} ${params.url}`, output: JSON.stringify(result, null, 2) }
              }
            }
            case "save_connection": {
              if (!params.name || !params.base_url)
                return yield* Effect.fail(new Error("name and base_url are required for save_connection action"))
              const conn = yield* svc.saveConnection(params.name, params.base_url, params.auth_type ?? "none", params.auth_value)
              return { title: `API Connection Saved: ${conn.name}`, output: `Saved connection ${conn.name} (${conn.base_url}) with ID: ${conn.id}` }
            }
            case "list_connections": {
              const connections = yield* svc.listConnections()
              const output = connections.length === 0
                ? "No saved connections."
                : connections.map((c: any) => `- ${c.name} (${c.base_url})${c.auth_type ? ` [${c.auth_type}]` : ""} | ${c.id}`).join("\n")
              return { title: "Conexões salvas", output }
            }
          }
        }).pipe(Effect.orDie),
    }
  }),
)
