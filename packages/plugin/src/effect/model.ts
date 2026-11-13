import type { ModelApi } from "@opencode/client/effect/api"
import type { Agent } from "@opencode/schema/agent"
import type { Model } from "@opencode/schema/model"
import type { Session } from "@opencode/schema/session"
import type { Effect, Types } from "effect"
import type { ProviderRecord } from "./provider.js"
import type { SessionRequestKind } from "./session.js"
import type { ModelHooks, Transform } from "./registration.js"

export interface ModelEditor {
  /** Candidates from available providers, including models disabled by earlier transforms. */
  list(providerID?: string): readonly Types.DeepMutable<Model.Info>[]
  get(providerID: string, modelID: string): Types.DeepMutable<Model.Info> | undefined
  /** Edits raw model overrides; cannot create an unavailable provider. */
  update(providerID: string, modelID: string, update: (model: Types.DeepMutable<Model.Info>) => void): void
  remove(providerID: string, modelID: string): void
  readonly default: {
    get(): { providerID: string; modelID: string } | undefined
    set(providerID: string, modelID: string): void
  }
  /** Immutable provider inputs, including inactive templates, before model transforms. */
  readonly provider: {
    list(): readonly ProviderRecord[]
    get(providerID: string): ProviderRecord | undefined
  }
}

/** The Session that made a model request. Experimental. */
export interface ModelRequestSession {
  readonly id: Session.ID
  readonly agent: Agent.ID
}

/**
 * Which model is called and why. `session` is set for a Session's own model requests, so checking it narrows `kind`
 * to the Session kinds. A tool that calls Generate from inside a Session makes a Generate call with no `session`.
 * Experimental.
 */
export type ModelRequestScope = { readonly model: Model.Ref } & (
  | { readonly kind: SessionRequestKind; readonly session: ModelRequestSession }
  | { readonly kind: "text" | "image" | "decision"; readonly session?: undefined }
)

/** An HTTP request to a model provider, before it is sent. Replace `request` to change it. Experimental. */
export type ModelHttpRequest = ModelRequestScope & {
  request: Request
}

/** The provider's HTTP response to `request`. Replace `response` to change what the model client reads. Experimental. */
export type ModelHttpResponse = ModelRequestScope & {
  readonly request: Request
  response: Response
}

/**
 * Hooks on every HTTP request to a model provider, whichever Session or API makes it: Session steps, compaction,
 * titles and warming, and `generate` text, image and decision calls. Use these to read or change what is sent on the
 * wire (URL, headers, body) or the raw response. WebSocket traffic doesn't pass through them. Experimental.
 */
export interface ModelRequestHooks {
  readonly "experimental.http.request": ModelHttpRequest
  readonly "experimental.http.response": ModelHttpResponse
}

export interface ModelDomain extends ModelApi<unknown> {
  readonly hook: ModelHooks<ModelRequestHooks>
  readonly transform: Transform<ModelEditor>
  readonly reload: () => Effect.Effect<void>
}
