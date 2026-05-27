import { Context, Effect } from "effect"

export interface Interface {
  readonly closeAll: Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@yunpat/HttpApiServer") {}

export * as HttpApiServer from "./httpapi-server"
