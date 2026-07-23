import { Effect, Layer, Context, Schema, Option, Config } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { httpClient } from "@opencode-ai/core/effect/app-node-platform"
import { LinearMcpError } from "./mcp-client"

/**
 * Schema for a Linear GraphQL response body. Per ADR-0005 D7, the service
 * returns the parsed JSON body and the caller interprets it. We use
 * `Schema.decodeUnknownOption` (per AGENTS.md "Prefer Effect schema helpers
 * ... over manual `JSON.parse` wrapped in `Effect.try`") to validate the
 * envelope shape without constraining the inner `data` payload.
 */
const GraphqlResponse = Schema.Struct({
  data: Schema.optional(Schema.Unknown),
  errors: Schema.optional(Schema.Array(Schema.Struct({ message: Schema.String }))),
})
const decodeResponse = Schema.decodeUnknownOption(GraphqlResponse)

/**
 * LinearGraphqlClient — direct Linear GraphQL API client.
 *
 * Per ADR-0005 D7: the existing `clearDueDateViaGraphQL` bypass in
 * `sync-push.ts` is refactored into this shared service so both the sync
 * path (SyncPush) and the agent tool path (`linear_graphql`) use a single
 * source of truth for "how to talk to Linear GraphQL".
 *
 * Why this exists (ADR-0001 Amendment 2026-07-17, extended by ADR-0005):
 * the Linear MCP server's `save_issue` tool rejects `null` for fields
 * typed as `string` in its Zod schema (e.g. `dueDate`, `description`),
 * making it impossible to clear those fields via MCP. The Linear GraphQL
 * API accepts `null` natively, so this client is the canonical path for
 * null-clearing operations. It also exposes `issueDelete`, which MCP does
 * not provide at all.
 *
 * Authentication: `LINEAR_API_KEY` environment variable, sent as the raw
 * `Authorization: <key>` header (Linear's accepted format — not
 * `Bearer <key>`). This matches the existing bypass behavior.
 *
 * The service returns the raw parsed JSON response body. The caller is
 * responsible for interpreting success/failure and extracting fields.
 */
export interface Interface {
  /**
   * Execute a GraphQL mutation (or query) against the Linear API.
   *
   * @param mutation - the GraphQL operation body, e.g.
   *   `mutation($id: String!, $input: IssueUpdateInput!) {
   *      issueUpdate(id: $id, input: $input) { success issue { id } }
   *    }`
   * @param variables - the variables object, e.g.
   *   `{ id: "LIN-123", input: { dueDate: null } }`
   * @returns the parsed JSON response body. On HTTP failure, transport
   *   error, or GraphQL `errors` array, fails with `LinearMcpError`.
   */
  readonly call: (mutation: string, variables: Record<string, unknown>) => Effect.Effect<unknown, LinearMcpError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Issue/LinearGraphqlClient") {}

const LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql"

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    // Read LINEAR_API_KEY once at layer construction via Effect's Config
    // system (per AGENTS.md [P4] — prefer Config over `process.env`).
    // `Config.string` is used instead of `Config.secret` because this
    // Effect v4 beta version does not provide `Config.secret`; the raw
    // key is sent as an HTTP header to Linear anyway, so redaction at
    // rest in memory provides no meaningful protection here.
    const keyOption = yield* Config.string("LINEAR_API_KEY").pipe(Config.option)
    const keyStr = Option.getOrNull(keyOption)

    const call = Effect.fn("LinearGraphqlClient.call")(function* (
      mutation: string,
      variables: Record<string, unknown>,
    ) {
      if (!keyStr) {
        return yield* new LinearMcpError({ message: "LINEAR_API_KEY not set for Linear GraphQL client" })
      }

      const request = yield* HttpClientRequest.post(LINEAR_GRAPHQL_URL).pipe(
        HttpClientRequest.setHeaders({
          "Content-Type": "application/json",
          Authorization: keyStr,
        }),
        HttpClientRequest.bodyJson({ query: mutation, variables }),
        Effect.mapError(
          (e) =>
            new LinearMcpError({
              message: `Linear GraphQL request build failed: ${String(e)}`,
              cause: e,
            }),
        ),
      )

      const response = yield* http.execute(request).pipe(
        Effect.mapError(
          (e) =>
            new LinearMcpError({
              message: `Linear GraphQL request failed: ${String(e)}`,
              cause: e,
            }),
        ),
      )

      const raw = yield* response.json.pipe(
        Effect.mapError(
          (e) =>
            new LinearMcpError({
              message: `Linear GraphQL response parse failed: ${String(e)}`,
              cause: e,
            }),
        ),
      )

      const data = Option.getOrUndefined(decodeResponse(raw))
      if (!data) {
        return yield* new LinearMcpError({ message: "Linear GraphQL response shape invalid" })
      }

      if (data.errors && data.errors.length > 0) {
        return yield* new LinearMcpError({
          message: `Linear GraphQL errors: ${data.errors.map((e) => e.message).join(", ")}`,
        })
      }

      return data.data
    })

    return Service.of({ call })
  }),
)

export const node = LayerNode.make({ service: Service, layer: layer, deps: [httpClient] })

export * as LinearGraphqlClient from "./linear-graphql"
