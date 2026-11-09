import type { ModelApi } from "@opencode/client/effect/api"
import type { Agent } from "@opencode/schema/agent"
import type { Model } from "@opencode/schema/model"
import type { Session } from "@opencode/schema/session"
import type { Effect, Types } from "effect"
import type { ProviderRecord } from "./provider.js"
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

/**
 * Why a model request is being made. Session requests use `primary`, `compaction`, `title` and `generate`; the
 * stateless generate API uses `text`, `image` and `decision`. Experimental.
 */
export type ModelRequestKind = "primary" | "compaction" | "title" | "generate" | "text" | "image" | "decision"

/** Who is making a model request. `sessionID` and `agent` are set only when a Session makes it. Experimental. */
export interface ModelRequestScope {
  readonly model: Model.Ref
  readonly kind: ModelRequestKind
  readonly sessionID?: Session.ID
  readonly agent?: Agent.ID
}

/** An HTTP request to a model provider, before it is sent. Replace `request` to change it. Experimental. */
export interface ModelHttpRequest extends ModelRequestScope {
  request: Request
}

/** The provider's HTTP response to `request`. Replace `response` to change what the model client reads. Experimental. */
export interface ModelHttpResponse extends ModelRequestScope {
  readonly request: Request
  response: Response
}

/**
 * Hooks on every model request, whichever Session or API makes it: Session steps, compaction and titles, and
 * `generate` text, image and decision calls.
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
