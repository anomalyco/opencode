export * as BuiltInTools from "./builtins"

import { makeLocationNode } from "../effect/app-node"
import { Context, Layer } from "effect"
import { ApplyPatchTool } from "./apply-patch"
import { EditTool } from "./edit"
import { GrepTool } from "./grep"
import { QuestionTool } from "./question"
import { ReadTool } from "./read"
import { ReadToolFileSystem } from "./read-filesystem"
import { SkillTool } from "./skill"
import { TodoWriteTool } from "./todowrite"
import { WebFetchTool } from "./webfetch"
import { WebSearchTool } from "./websearch"
import { WriteTool } from "./write"

export class Service extends Context.Service<Service, Record<string, never>>()("@opencode/v2/BuiltInTools") {}

/**
 * Composes only the shipped Location-scoped built-in tool transforms.
 * Each tool retains its implementation and focused tests independently. Dynamic
 * MCP and plugin tools later use separate scoped canonical registrations, while
 * provider/model filtering belongs to a future materialization phase rather
 * than this static list. The caller intentionally supplies shared Location
 * services once to this merged set.
 *
 * TODO: Port the remaining launch-follow-up leaves deliberately: edit fuzzy
 * parity, task, LSP,
 * repo_clone, repo_overview, plan_exit, and Rune/code mode. Keep MCP and plugin
 * transforms separate from this static built-in list.
 */
const layer = Layer.succeed(Service, Service.of({}))

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [
    ApplyPatchTool.node,
    EditTool.node,
    GrepTool.node,
    QuestionTool.node,
    ReadTool.node,
    ReadToolFileSystem.node,
    SkillTool.node,
    TodoWriteTool.node,
    WebFetchTool.node,
    WebSearchTool.node,
    WebSearchTool.configNode,
    WriteTool.node,
  ],
})
