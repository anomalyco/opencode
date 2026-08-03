export * as CronNode from "./node"

import type { LocationNode } from "../effect/app-node"
import { Layer } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { CronService, layer as cronLayer } from "./service"
import { CronDeliveryPortLive } from "./port-v2"
import { Database } from "../database/database"
import { EventV2 } from "../event"
import { SessionExecution } from "../session/execution"
import { SessionV2 } from "../session"

export const node: LocationNode<CronService> = makeLocationNode({
  service: CronService,
  layer: cronLayer.pipe(Layer.provide(CronDeliveryPortLive)),
  deps: [Database.node, EventV2.node, SessionExecution.node, SessionV2.node],
})
