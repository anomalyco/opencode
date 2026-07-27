export * as CronNode from "./node"

import { Layer } from "effect"
import { makeLocationNode } from "@opencode-ai/core/effect/app-node"
import { CronService, layer as cronLayer } from "@opencode-ai/core/cron/service"
import { CronDeliveryPortLive } from "./port-legacy"
import { SessionRunState } from "@/session/run-state"
import { SessionPrompt } from "@/session/prompt"
import { Session } from "@/session/session"

export const node = makeLocationNode({
  service: CronService,
  layer: cronLayer.pipe(Layer.provide(CronDeliveryPortLive)),
  deps: [SessionRunState.node, SessionPrompt.node, Session.node],
})
