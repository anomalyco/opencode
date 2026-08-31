export * as SessionRevertNode from "./revert-node.js"

import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { Bus } from "../bus.js"
import { Database } from "../database/database.js"
import { PluginSupervisor } from "../plugin/supervisor.js"
import { Snapshot } from "../snapshot.js"
import { SessionRevert } from "./revert.js"

// Keep the supervisor implementation out of the global Session import path.
export const node = makeLocationNode({
  service: SessionRevert.Service,
  layer: SessionRevert.layer,
  deps: [Database.node, Bus.node, PluginSupervisor.node, Snapshot.node],
})
