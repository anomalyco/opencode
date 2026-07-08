import { Effect, Layer, LayerMap } from "effect"
import { AgentV2 } from "./agent"
import { AISDK } from "./aisdk"
import { Catalog } from "./catalog"
import { CommandV2 } from "./command"
import { Config } from "./config"
import { LayerNode } from "./effect/layer-node"
import { Node } from "./effect/app-node"
import { EventV2 } from "./event"
import { FileMutation } from "./file-mutation"
import { FileSystem } from "./filesystem"
import { FileSystemSearch } from "./filesystem/search"
import { Generate } from "./generate"
import { Form } from "./form"
import { Image } from "./image"
import { LocationWatcher } from "./filesystem/location-watcher"
import { Integration } from "./integration"
import { Location } from "./location"
import { LocationMutation } from "./location-mutation"
import { LocationServiceMap } from "./location-service-map"
import { MCP } from "./mcp/index"
import { PermissionV2 } from "./permission"
import { PluginV2 } from "./plugin"
import { PluginSupervisor } from "./plugin/supervisor"
import { ProjectCopy } from "./project/copy"
import { Pty } from "./pty"
import { QuestionV2 } from "./question"
import { Shell } from "./shell"
import { Reference } from "./reference"
import { ReferenceGuidance } from "./reference/guidance"
import { SessionRunnerLLM } from "./session/runner/llm"
import { SessionRunnerModel } from "./session/runner/model"
import { SessionCompaction } from "./session/compaction"
import { SessionTitle } from "./session/title"
import { SessionTodo } from "./session/todo"
import { SkillV2 } from "./skill"
import { SkillGuidance } from "./skill/guidance"
import { Snapshot } from "./snapshot"
import { InstructionDiscovery } from "./instruction-discovery"
import { InstructionBuiltIns } from "./instructions/builtins"
import { InstructionEntry } from "./session/instruction-entry"
import { SessionInstructions } from "./session/instructions"
import { McpTool } from "./tool/mcp"
import { ReadToolFileSystem } from "./tool/read-filesystem"
import { ToolRegistry } from "./tool/registry"
import { ToolOutputStore } from "./tool-output-store"
import { Vcs } from "./vcs"

export { LocationServiceMap } from "./location-service-map"

const locationServiceNodes = [
  Location.node,
  Config.node,
  AgentV2.node,
  CommandV2.node,
  Reference.node,
  Integration.node,
  Catalog.node,
  AISDK.node,
  PluginV2.node,
  PluginSupervisor.node,
  ProjectCopy.node,
  ProjectCopy.refreshNode,
  FileSystemSearch.node,
  FileSystem.node,
  Pty.node,
  Shell.node,
  SkillV2.node,
  InstructionBuiltIns.node,
  InstructionDiscovery.node,
  LocationMutation.node,
  FileMutation.node,
  MCP.node,
  PermissionV2.node,
  ToolOutputStore.node,
  ToolRegistry.node,
  ToolRegistry.toolsNode,
  Image.node,
  SkillGuidance.node,
  ReferenceGuidance.node,
  SessionTodo.node,
  InstructionEntry.node,
  Form.node,
  QuestionV2.node,
  Generate.node,
  ReadToolFileSystem.node,
  McpTool.node,
  SessionInstructions.node,
  SessionRunnerModel.node,
  SessionCompaction.node,
  SessionTitle.node,
  Snapshot.node,
  SessionRunnerLLM.node,
  Vcs.node,
  // Start repository watches only after boot-critical filesystem and Git work.
  LocationWatcher.node,
] as const satisfies readonly Node.LocationNode<unknown, unknown>[]

export const locationServices = LayerNode.group<typeof locationServiceNodes>(locationServiceNodes)

export type LocationServices = LayerNode.Output<typeof locationServices>
export type LocationError = LayerNode.Error<typeof locationServices>

export function buildLocationServiceMap(
  replacements: LayerNode.Replacements = [],
): Layer.Layer<LocationServiceMap.Service> {
  // Structural Equal is own-key-set sensitive, so `{ directory }` (schema-decoded
  // payloads omit optional keys) and `{ directory, workspaceID: undefined }` are
  // different RcMap keys. The RcMap caches by the raw key before the build
  // callback runs, so canonicalize at the map boundary to the key-present shape.
  const canonical = (ref: Location.Ref) => Location.Ref.make({ directory: ref.directory, workspaceID: ref.workspaceID })
  return Layer.effect(
    LocationServiceMap.Service,
    Effect.map(
      LayerMap.make(
        (ref: Location.Ref) => {
          const startedAt = performance.now()
          const allReplacements = replacements.concat([[Location.node, Location.boundNode(ref)]])
          // Apply replacements during hoist, not afterward: replacements can
          // introduce new tagged dependencies (Location.boundNode depends on
          // Project), and the hoist walk is the only pass that can still slice
          // those back out.
          const location = LayerNode.hoist(locationServices, Node.tags.values.global, allReplacements)

          return LayerNode.compile(location.node).pipe(
            Layer.fresh,
            Layer.tap(() =>
              Effect.logInfo("location services booted", {
                directory: ref.directory,
                workspaceID: ref.workspaceID,
                durationMs: Math.round(performance.now() - startedAt),
              }),
            ),
            Layer.provide(LayerNode.compile(location.hoisted)),
          )
        },
        { idleTimeToLive: "60 minutes" },
      ),
      (inner) => ({
        ...inner,
        get: (ref: Location.Ref) => inner.get(canonical(ref)),
        contextEffect: (ref: Location.Ref) => inner.contextEffect(canonical(ref)),
        invalidate: (ref: Location.Ref) => inner.invalidate(canonical(ref)),
      }),
    ),
  )
}

// This is temporary for backwards compatibility
export const locationServiceMapLayer = buildLocationServiceMap()
