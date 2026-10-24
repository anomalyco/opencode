export * as WebSearchProviderSettings from "./settings.js"

import type { IntegrationDomain } from "@opencode/plugin/effect/integration"
import type { WebSearch } from "@opencode/schema/websearch"
import { Effect } from "effect"

/**
 * Resolve a provider's endpoint and key. A custom endpoint never receives the stored or environment
 * credential: only an explicitly configured `apiKey` is sent, so a project-level config cannot
 * redirect a user's credential to an arbitrary URL.
 */
export function resolve(
  integration: IntegrationDomain,
  integrationID: string,
  settings: WebSearch.Settings | undefined,
  defaultEndpoint: string,
) {
  if (settings?.endpoint) return Effect.succeed({ endpoint: settings.endpoint, key: settings.apiKey })
  return Effect.gen(function* () {
    const connection = yield* integration.connection.active(integrationID)
    const credential = connection ? yield* integration.connection.resolve(connection) : undefined
    return {
      endpoint: defaultEndpoint,
      key: settings?.apiKey || (credential?.type === "key" ? credential.key : undefined),
    }
  })
}
