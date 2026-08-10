import { Cause, Duration, Effect, Layer, LayerMap } from "effect"
import { Agent } from "./agent"
import { AISDK } from "./aisdk"
import { Catalog } from "./catalog"
import { Command } from "./command"
import { Config } from "./config"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Node } from "@opencode-ai/util/effect/app-node"
import { Bus } from "./bus"
import { FileMutation } from "./file-mutation"
import { Environment } from "./environment"
import { Formatter } from "./formatter"
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
import { ToolOutput } from "./tool-output"
import { Vcs } from "./vcs"

export { LocationServiceMap } from "./location-service-map"

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
  ToolOutput.node,
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

export function buildLocationServiceMap(
  replacements: LayerNode.Replacements = [],
  options?: { bootFailureRetry?: Duration.Input },
): Layer.Layer<LocationServiceMap.Service> {
  // Structural Equal is own-key-set sensitive, so `{ directory }` (schema-decoded
  // payloads omit optional keys) and `{ directory, workspaceID: undefined }` are
  // different RcMap keys. The RcMap caches by the raw key before the build
  // callback runs, so canonicalize at the map boundary to the key-present shape.
  const canonical = (ref: Location.Ref) => Location.Ref.make({ directory: ref.directory, workspaceID: ref.workspaceID })
  const bootFailureRetry = Duration.fromInputUnsafe(options?.bootFailureRetry ?? "5 seconds")
  return Layer.effect(
    LocationServiceMap.Service,
    Effect.gen(function* () {
      const scope = yield* Effect.scope
      // The RcMap caches a failed boot exactly like a successful one, for the
      // full idleTimeToLive, and nothing in production invalidates it: one
      // transient boot error would poison the location for an hour. Evict the
      // failed entry after a short delay instead. The delay matters: a failed
      // boot still publishes agent/command/catalog.updated, clients refetch on
      // those, and an immediate eviction would let a persistently failing
      // location rebuild in a hot loop. The lookup runs once per cached entry,
      // so exactly one eviction is scheduled per failed boot. Eviction is best
      // effort: invalidate no-ops while the entry is referenced, and the entry
      // then falls back to the idleTimeToLive.
      const evict: { current?: (ref: Location.Ref) => Effect.Effect<void> } = {}
      const inner = yield* LayerMap.make(
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
            Layer.tapCause((cause) => {
              if (Cause.hasInterruptsOnly(cause)) return Effect.void
              return Effect.suspend(() => evict.current!(ref)).pipe(
                Effect.delay(bootFailureRetry),
                Effect.forkIn(scope),
              )
            }),
          )
        },
        { idleTimeToLive: "60 minutes" },
      )
      evict.current = (ref) => inner.invalidate(ref)
      return {
        ...inner,
        get: (ref: Location.Ref) => inner.get(canonical(ref)),
        contextEffect: (ref: Location.Ref) => inner.contextEffect(canonical(ref)),
        invalidate: (ref: Location.Ref) => inner.invalidate(canonical(ref)),
      }
    }),
  )
}
