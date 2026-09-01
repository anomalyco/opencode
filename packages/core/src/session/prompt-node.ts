export * as SessionPromptNode from "./prompt-node.js"

import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Image } from "../image.js"
import { PluginHooks } from "../plugin/hooks.js"
import { PluginSupervisor } from "../plugin/supervisor.js"
import { Skill } from "../skill.js"
import { SessionPrompt } from "./prompt.js"

// Keep the supervisor implementation out of the global Session import path.
export const node = makeLocationNode({
  service: SessionPrompt.Service,
  layer: SessionPrompt.layer,
  deps: [FSUtil.node, PluginSupervisor.node, PluginHooks.node, Image.node, Skill.node],
})
