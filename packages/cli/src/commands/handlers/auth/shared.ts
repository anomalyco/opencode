import { Effect } from "effect"
import { OpenCode, type IntegrationInfo, type IntegrationMethod, type OpenCodeClient } from "@opencode-ai/client"
import { Service } from "@opencode-ai/client/effect/service"
import { ServerConnection } from "../../../services/server-connection"

export const location = { directory: process.cwd() }

export const createClient = Effect.fn("cli.auth.client")(function* (input: ServerConnection.Args) {
  const server = yield* ServerConnection.resolve(input)
  return OpenCode.make({ baseUrl: server.endpoint.url, headers: Service.headers(server.endpoint) })
})

export function request<A>(run: (signal: AbortSignal) => Promise<A>) {
  return Effect.tryPromise({ try: run, catch: (cause) => cause })
}

export const loadIntegrations = Effect.fn("cli.auth.integrations")(function* (client: OpenCodeClient) {
  // The model endpoint is the existing public readiness boundary for the initial plugin generation.
  yield* request((signal) => client.model.default({ location }, { signal }))
  return yield* request((signal) => client.integration.list({ location }, { signal })).pipe(
    Effect.map((response) => response.data),
  )
})

export const resolveIntegration = Effect.fn("cli.auth.resolve-integration")(function* (
  integrations: IntegrationInfo[],
  target: string,
) {
  const normalized = target.replace(/\/+$/, "")
  const byID = integrations.find((integration) => integration.id === normalized)
  if (byID) return byID
  const matches = integrations.filter((integration) => integration.name.toLowerCase() === normalized.toLowerCase())
  if (matches.length === 1) return matches[0]
  if (matches.length > 1) {
    return yield* Effect.fail(
      new Error(
        `Integration name "${target}" is ambiguous: ${matches.map((integration) => integration.id).join(", ")}`,
      ),
    )
  }
  return yield* Effect.fail(new Error(`Integration not found: ${target}`))
})

export type ConnectMethod = Exclude<IntegrationMethod, { type: "env" }>

export function connectMethods(integration: IntegrationInfo) {
  return integration.methods
    .filter((method): method is ConnectMethod => method.type !== "env")
    .toSorted((a, b) => Number(a.type === "key") - Number(b.type === "key"))
}

export const resolveMethod = Effect.fn("cli.auth.resolve-method")(function* (methods: ConnectMethod[], target: string) {
  const normalized = target.toLowerCase()
  const matches = methods.filter((method) => {
    if (method.type === "key") return normalized === "key" || method.label?.toLowerCase() === normalized
    return method.id === target || method.label.toLowerCase() === normalized
  })
  if (matches.length === 1) return matches[0]
  if (matches.length > 1) return yield* Effect.fail(new Error(`Authentication method "${target}" is ambiguous`))
  const available = methods.map((method) => (method.type === "key" ? "key" : method.id)).join(", ")
  return yield* Effect.fail(
    new Error(`Authentication method not found: ${target}${available ? `. Available: ${available}` : ""}`),
  )
})
