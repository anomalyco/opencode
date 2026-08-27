import { Duration, Effect, Layer, LayerMap } from "effect"
import { existsSync } from "fs"
import path from "path"
import { Agent } from "./agent.js"
import { AISDK } from "./aisdk.js"
import { Catalog } from "./catalog.js"
import { Command } from "./command.js"
import { Config } from "./config.js"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Node } from "@opencode-ai/util/effect/app-node"
import { Bus } from "./bus.js"
import { FileMutation } from "./file-mutation.js"
import { Environment } from "./environment/index.js"
import { Formatter } from "./formatter.js"
import { FileSystem } from "./filesystem.js"
import { FileSystemSearch } from "./filesystem/search.js"
import { Generate } from "./generate.js"
import { Form } from "./form.js"
import { Image } from "./image.js"
import { LocationWatcher } from "./filesystem/location-watcher.js"
import { Integration } from "./integration.js"
import { Location } from "./location.js"
import { LocationMutation } from "./location-mutation.js"
import { LocationServiceMap } from "./location-service-map.js"
import { ModelResolver } from "./model-resolver.js"
import { MCP } from "./mcp/index.js"
import { Permission } from "./permission.js"
import { Plugin } from "./plugin.js"
import { PluginHooks } from "./plugin/hooks.js"
import { PluginSupervisor } from "./plugin/supervisor.js"
import { Worktree } from "./worktree.js"
import { Pty } from "./pty.js"
import { Shell } from "./shell.js"
import { ShellSelect } from "./shell/select.js"
import { Reference } from "./reference.js"
import { WebSearch } from "./websearch.js"
import { ReferenceInstructions } from "./reference/instructions.js"
import { SessionRunnerLLM } from "./session/runner/llm.js"
import { SessionRunnerModel } from "./session/runner/model.js"
import { SessionModelTransport } from "./session/model-transport.js"
import { SessionCompaction } from "./session/compaction.js"
import { SessionTitle } from "./session/title.js"
import { Skill } from "./skill.js"
import { SkillInstructions } from "./skill/instructions.js"
import { Snapshot } from "./snapshot.js"
import { InstructionDiscovery } from "./instruction-discovery.js"
import { InstructionBuiltIns } from "./instructions/builtins.js"
import { InstructionEntry } from "./session/instruction-entry.js"
import { SessionInstructions } from "./session/instructions.js"
import { SessionGenerateNode } from "./session/generate-node.js"
import { McpTool } from "./tool/mcp.js"
import { ReadToolFileSystem } from "./tool/read-filesystem.js"
import { Tool } from "./tool.js"
import { ToolOutput } from "./tool-output.js"
import { Vcs } from "./vcs.js"
import { AbsolutePath } from "./schema.js"

export { LocationServiceMap } from "./location-service-map.js"

const locationServiceNodes = [
  Location.node,
  Environment.node,
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
  PluginHooks.node,
  PluginSupervisor.node,
  Worktree.refreshNode,
  FileSystemSearch.node,
  FileSystem.node,
  ShellSelect.node,
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
  ToolOutput.node,
  Image.node,
  SkillInstructions.node,
  ReferenceInstructions.node,
  InstructionEntry.node,
  Form.node,
  Generate.node,
  SessionGenerateNode.node,
  ReadToolFileSystem.node,
  McpTool.node,
  SessionInstructions.node,
  SessionRunnerModel.node,
  SessionModelTransport.node,
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
  // Structural Equal distinguishes optional-key shape and Windows separator style.
  // The RcMap caches the raw key before the build callback, so normalize both here.
  const canonical = (ref: Location.Ref) =>
    Location.Ref.make({
      directory: AbsolutePath.make(process.platform === "win32" ? path.normalize(ref.directory) : ref.directory),
      workspaceID: ref.workspaceID,
    })
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
        {
          // Workspace-placed directories exist only inside the workspace, so a
          // local stat consults the wrong filesystem. Workspace liveness is
          // owned by placement; do not probe the sandbox here, which would
          // provision lazily-idle workspaces.
          idleTimeToLive: (ref) =>
            ref.workspaceID !== undefined || existsSync(ref.directory) ? Duration.infinity : Duration.zero,
        },
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
