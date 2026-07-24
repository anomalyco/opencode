export * as ToolProviders from "./providers"

import { Context, Effect, Scope } from "effect"
import { SessionSchema } from "../session/schema"
import { Tool } from "./tool"

export type Provided = Readonly<Record<string, { readonly tool: Tool.Any; readonly permission?: string }>>

/**
 * Request-local direct tools. Provider tools never enter Code Mode. Canonical
 * direct tools and effective Code Mode names win collisions; `execute` is
 * reserved, and later provider collisions are omitted from the request.
 */
export type Provider = (sessionID: SessionSchema.ID) => Effect.Effect<Provided>

export interface Interface {
  readonly register: (provider: Provider) => Effect.Effect<void, never, Scope.Scope>
}

/** Narrow registration capability for privileged Location-scoped tool providers. */
export class Service extends Context.Service<Service, Interface>()("@opencode/v2/ToolProviders") {}
