import { Effect, Layer, LayerMap } from "effect"
import { Agent } from "./agent"
import { AISDK } from "./aisdk"
import { Catalog } from "./catalog"
import { Command } from "./command"
import { Config } from "./config"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Node } from "@opencode-ai/util/effect/app-node"
import { Bus } from "./bus"
import { FileMutation } from "./file-mutation"
import { Formatter } from "./formatter"
import { FileSystem } from "./filesystem"
import { FileSystemSearch } from "./filesystem/search"
import { Ripgrep } from "./ripgrep"
import { Generate } from "./generate"
import { Form } from "./form"
import { Image } from "./image"
import { LocationWatcher } from "./filesystem/location-watcher"
import { Integration } from "./integration"
import { Location } from "./location"
import { LocationMutation } from "./location-mutation"
import { LocationServiceMap } from "./location-service-map"
import { ModelResolver } from "./model-resolver"
import { MCP } from "./mcp/index"
import { Permission } from "./permission"
import { Plugin } from "./plugin"
import { PluginSupervisor } from "./plugin/supervisor"
import { ProjectCopy } from "./project/copy"
import { Pty } from "./pty"
import { Question } from "./question"
import { Shell } from "./shell"
import { Reference } from "./reference"
import { WebSearch } from "./websearch"
import { ReferenceInstructions } from "./reference/instructions"
import { SessionRunnerLLM } from "./session/runner/llm"
import { SessionRunnerModel } from "./session/runner/model"
import { SessionCompaction } from "./session/compaction"
import { SessionTitle } from "./session/title"
import { Skill } from "./skill"
import { SkillInstructions } from "./skill/instructions"
import { Snapshot } from "./snapshot"
import { InstructionDiscovery } from "./instruction-discovery"
import { InstructionBuiltIns } from "./instructions/builtins"
import { InstructionEntry } from "./session/instruction-entry"
import { SessionInstructions } from "./session/instructions"
import { SessionGenerateNode } from "./session/generate-node"
import { McpTool } from "./tool/mcp"
import { ReadToolFileSystem } from "./tool/read-filesystem"
import { Tool } from "./tool"
import { Vcs } from "./vcs"
import { Workspace } from "@opencode-ai/schema/workspace"
import { WorkspaceEnvironment } from "./workspace/environment"

export { LocationServiceMap } from "./location-service-map"

const locationServiceNodes = [
  Location.node,
  Config.node,
  Agent.node,
  Command.node,
  Reference.node,
  WebSearch.node,
  Integration.node,
  Catalog.node,
  ModelResolver.node,
  AISDK.node,
  Plugin.node,
  PluginSupervisor.node,
  ProjectCopy.node,
  ProjectCopy.refreshNode,
  FileSystemSearch.node,
  FileSystem.node,
  Pty.node,
  Shell.node,
  Skill.node,
  InstructionBuiltIns.node,
  InstructionDiscovery.node,
  LocationMutation.node,
  FileMutation.node,
  Formatter.node,
  MCP.node,
  Permission.node,
  Tool.node,
  Image.node,
  SkillInstructions.node,
  ReferenceInstructions.node,
  InstructionEntry.node,
  Form.node,
  Question.node,
  Generate.node,
  SessionGenerateNode.node,
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

/**
 * Hosted graphs state their Location (no host discovery), read only global
 * config sources, and bind the workspace environment; local graphs are
 * byte-identical to before. Exported so tests can verify that every
 * Location-path-consuming service is environment-backed in hosted graphs.
 */
export function hostedReplacements(ref: Location.Ref, workspaceID: Workspace.ID): LayerNode.Replacements {
  return [
    [Location.node, Location.hostedBoundNode(ref, workspaceID)],
    [Config.node, Config.configured({ project: false })],
    [InstructionDiscovery.node, InstructionDiscovery.configured({ project: false })],
    [WorkspaceEnvironment.node, WorkspaceEnvironment.hostedNode(workspaceID)],
    [Ripgrep.node, Ripgrep.hostedNode],
    [FileSystem.node, FileSystem.hostedNode],
    [LocationMutation.node, LocationMutation.hostedNode],
    [FileMutation.node, FileMutation.hostedNode],
    [ReadToolFileSystem.node, ReadToolFileSystem.hostedNode],
    [Shell.node, Shell.hostedNode],
  ]
}

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
          const workspaceID = ref.workspaceID
          const allReplacements = replacements.concat(
            workspaceID ? hostedReplacements(ref, workspaceID) : [[Location.node, Location.boundNode(ref)]],
          )
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
