export * as SessionModelHook from "./model-hook.js"

import { HttpOptions, LanguageModel, LLMRequest } from "@opencode-ai/ai"
import type { Agent } from "@opencode-ai/schema/agent"
import type { Model } from "@opencode-ai/schema/model"
import type { Session } from "@opencode-ai/schema/session"
import { Effect } from "effect"
import { PluginHooks } from "../plugin/hooks.js"

export const apply = (
  hooks: PluginHooks.Interface,
  input: { readonly sessionID: Session.ID; readonly agent: Agent.ID; readonly model: Model.Ref },
  request: LLMRequest,
) =>
  Effect.gen(function* () {
    const currentBaseURL = request.model.route.endpoint.baseURL
    const event = yield* hooks.trigger("session", "model.request", {
      ...input,
      baseURL: typeof currentBaseURL === "string" ? currentBaseURL : undefined,
      headers: { ...request.http?.headers },
    })
    const route =
      event.baseURL !== undefined && event.baseURL !== currentBaseURL
        ? request.model.route.with({ endpoint: { baseURL: event.baseURL } })
        : request.model.route
    return LLMRequest.update(request, {
      model: route === request.model.route ? request.model : LanguageModel.update(request.model, { route }),
      http: new HttpOptions({
        body: request.http?.body,
        headers: Object.keys(event.headers).length === 0 ? undefined : event.headers,
        query: request.http?.query,
      }),
    })
  })
