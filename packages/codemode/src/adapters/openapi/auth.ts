import { Effect } from "effect"
import { ToolError, toolError } from "../../tool-error.js"
import { own } from "./shared.js"
import type { AppliedAuth, Credential, Plan, SecurityScheme } from "./types.js"

export const resolveAuth = (plan: Plan): Effect.Effect<AppliedAuth, unknown> =>
  Effect.gen(function* () {
    const none: AppliedAuth = { headers: {}, query: {}, cookies: {} }
    if (plan.security.length === 0) return none

    const unavailable: Array<string> = []
    alternatives: for (const requirement of plan.security) {
      const names = Object.keys(requirement)
      if (names.length === 0) return none
      const credentials: Array<readonly [SecurityScheme, Credential]> = []
      for (const name of names) {
        const scheme = own(plan.schemes, name)
        if (scheme === undefined || plan.auth === undefined) {
          unavailable.push(name)
          continue alternatives
        }
        const credential = yield* plan.auth.resolve({
          schemeName: name,
          scheme,
          scopes: requirement[name] ?? [],
          operation: plan.operation,
        })
        if (credential === undefined) {
          unavailable.push(name)
          continue alternatives
        }
        credentials.push([scheme, credential])
      }
      const applied = applyCredentials(credentials)
      return applied instanceof ToolError ? yield* Effect.fail(applied) : applied
    }

    return yield* Effect.fail(
      toolError(
        `${plan.operation.method} ${plan.operation.path} requires authentication; no credential available for: ${[...new Set(unavailable)].join(", ")}.`,
      ),
    )
  })

const applyCredentials = (credentials: ReadonlyArray<readonly [SecurityScheme, Credential]>): AppliedAuth | ToolError => {
  const headers: Record<string, string> = {}
  const query: Record<string, string> = {}
  const cookies: Record<string, string> = {}
  for (const [scheme, credential] of credentials) {
    if (credential.type === "bearer") {
      headers["authorization"] = `Bearer ${credential.token}`
      continue
    }
    if (credential.type === "basic") {
      // Buffer instead of btoa: btoa throws on non-Latin-1 credentials.
      headers["authorization"] =
        `Basic ${Buffer.from(`${credential.username}:${credential.password}`, "utf8").toString("base64")}`
      continue
    }
    if (credential.type === "header") {
      headers[credential.name.toLowerCase()] = credential.value
      continue
    }
    // apiKey: the carrier comes from the scheme declaration.
    const name = scheme.parameterName
    if (scheme.type !== "apiKey" || name === undefined || scheme.in === undefined) {
      return toolError(
        `Security scheme '${scheme.name}' is not an apiKey scheme; resolve a bearer, basic, or header credential for it.`,
      )
    }
    if (scheme.in === "header") headers[name.toLowerCase()] = credential.value
    if (scheme.in === "query") query[name] = credential.value
    if (scheme.in === "cookie") cookies[name] = credential.value
  }
  return { headers, query, cookies }
}
