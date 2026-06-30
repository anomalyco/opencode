export * as BuiltInTools from "./builtins"

import { makeLocationNode } from "../effect/app-node"
import { Context, Layer } from "effect"
import { ApplyPatchTool } from "./apply-patch"
import { EditTool } from "./edit"
import { GlobTool } from "./glob"
import { GrepTool } from "./grep"
import { QuestionTool } from "./question"
import { ReadTool } from "./read"
import { ReadToolFileSystem } from "./read-filesystem"
import { SkillTool } from "./skill"
import { TodoWriteTool } from "./todowrite"
import { WebFetchTool } from "./webfetch"
import { WebSearchTool } from "./websearch"
import { WriteTool } from "./write"
import { FSUtil } from "../fs-util"
import { Location } from "../location"
import { LocationMutation } from "../location-mutation"
import { FileMutation } from "../file-mutation"
import { PermissionV2 } from "../permission"
import { Ripgrep } from "../ripgrep"
import { Image } from "../image"
import { QuestionV2 } from "../question"
import { SkillV2 } from "../skill"
import { SessionTodo } from "../session/todo"
import { ToolRegistry } from "./registry"
import { httpClient } from "../effect/app-node-platform"

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
const registrations = Layer.mergeAll(
  ApplyPatchTool.layer,
  EditTool.layer,
  GlobTool.layer,
  GrepTool.layer,
  QuestionTool.layer,
  ReadTool.layer.pipe(Layer.provide(ReadToolFileSystem.layer)),
  SkillTool.layer,
  TodoWriteTool.layer,
  WebFetchTool.layer,
  WebSearchTool.layer.pipe(Layer.provide(WebSearchTool.defaultConfigLayer)),
  WriteTool.layer,
)

export const locationLayer = Layer.succeed(Service, Service.of({})).pipe(Layer.provideMerge(registrations))

export const node = makeLocationNode({
  service: Service,
  layer: locationLayer,
  deps: [
    ToolRegistry.toolsNode,
    FSUtil.node,
    Location.node,
    LocationMutation.node,
    FileMutation.node,
    PermissionV2.node,
    Ripgrep.node,
    Image.node,
    QuestionV2.node,
    SkillV2.node,
    SessionTodo.node,
    ReadToolFileSystem.node,
    httpClient,
  ],
})
