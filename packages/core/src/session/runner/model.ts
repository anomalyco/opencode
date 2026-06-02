export * as SessionRunnerModel from "./model"

import type { Model } from "@opencode-ai/llm"
import { Context, Effect, Layer } from "effect"
import { SessionSchema } from "../schema"

export interface Interface {
  readonly resolve: (session: SessionSchema.Info) => Effect.Effect<Model>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/session/runner/Model") {}

export const layer = (resolve: Interface["resolve"]) => Layer.succeed(Service, Service.of({ resolve }))
