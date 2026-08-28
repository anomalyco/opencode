import { Context, Effect, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/util/cross-spawn-spawner"
import { httpClient } from "@opencode-ai/util/effect/app-node-platform"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Global } from "@opencode-ai/util/global"
import { Npm } from "@opencode-ai/util/npm"
import { AppProcess } from "@opencode-ai/util/process"
import { Agent } from "./agent.js"
import { AISDK } from "./aisdk.js"
import { App } from "./app.js"
import { Bus } from "./bus.js"
import { Catalog } from "./catalog.js"
import { Command } from "./command.js"
import { Config } from "./config.js"
import { Credential } from "./credential.js"
import { Database } from "./database/database.js"
import { llmClient, webSocketConstructor } from "./effect/app-node-platform.js"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Node } from "@opencode-ai/util/effect/app-node"
import { FileMutation } from "./file-mutation.js"
import { Environment } from "./environment/index.js"
import { Formatter } from "./formatter.js"
import { FileSystem } from "./filesystem.js"
import { FileSystemSearch } from "./filesystem/search.js"
import { Generate } from "./generate.js"
import { Git } from "./git.js"
import { Form } from "./form.js"
import { Image } from "./image.js"
import { LocationWatcher } from "./filesystem/location-watcher.js"
import { Integration } from "./integration.js"
import { KV } from "./kv.js"
import { Location } from "./location.js"
import { LocationMutation } from "./location-mutation.js"
import { ModelResolver } from "./model-resolver.js"
import { ModelsDev } from "./models-dev.js"
import { Mcp } from "./mcp/index.js"
import { Permission } from "./permission.js"
import { PermissionSaved } from "./permission/saved.js"
import { Plugin } from "./plugin.js"
import { PluginHooks } from "./plugin/hooks.js"
import { InstancePlugins } from "./plugin/instance.js"
import { PluginRuntime } from "./plugin/runtime.js"
import { SdkPlugins } from "./plugin/sdk.js"
import { PluginSupervisor } from "./plugin/supervisor.js"
import { Project } from "./project.js"
import { ProjectMarkers } from "./project/markers.js"
import { Worktree } from "./worktree.js"
import { Pty } from "./pty.js"
import { Shell } from "./shell.js"
import { ShellSelect } from "./shell/select.js"
import { Reference } from "./reference.js"
import { RepositoryCache } from "./repository-cache.js"
import { RipgrepBinary } from "./ripgrep/binary.js"
import { WebSearch } from "./websearch.js"
import { ReferenceInstructions } from "./reference/instructions.js"
import { SessionRunnerLLM } from "./session/runner/llm.js"
import { SessionRunnerModel } from "./session/runner/model.js"
import { SessionModelTransport } from "./session/model-transport.js"
import { SessionCompaction } from "./session/compaction.js"
import { SessionTitle } from "./session/title.js"
import { SessionEnvironment } from "./session/environment.js"
import { SessionStore } from "./session/store.js"
import { Skill } from "./skill.js"
import { SkillDiscovery } from "./skill/discovery.js"
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
import { Watcher } from "./filesystem/watcher.js"
import { WellKnown } from "./wellknown.js"
import { Workspace } from "./workspace.js"

export * as Instance from "./instance.js"

const nodes = [
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
  InstancePlugins.node,
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
  Mcp.node,
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

export const graph = LayerNode.group<typeof nodes>(nodes)

export type Services = LayerNode.Output<typeof graph>
export type Error = LayerNode.Error<typeof graph>

const globalNodes = [
  CrossSpawnSpawner.node,
  Workspace.node,
  Watcher.node,
  Bus.node,
  FSUtil.node,
  Global.node,
  Credential.node,
  WellKnown.node,
  RepositoryCache.node,
  KV.node,
  AppProcess.node,
  Npm.node,
  App.node,
  llmClient,
  SessionStore.node,
  PermissionSaved.node,
  SdkPlugins.node,
  RipgrepBinary.node,
  httpClient,
  ProjectMarkers.node,
  ModelsDev.node,
  SessionEnvironment.node,
  Git.node,
  SkillDiscovery.node,
  Worktree.node,
  Database.node,
  webSocketConstructor,
  // Binding Location introduces Project even though the unbound graph does not.
  Project.node,
] as const satisfies readonly Node.GlobalNode<unknown, unknown>[]

const globalJobs = new Map([Shell.cleanupNode, ToolOutput.cleanupNode].map((node) => [node.name, node] as const))

/** Build and configure this graph once in the host scope, before composing instances. */
export const globalsGraph = LayerNode.group([...globalNodes, ...globalJobs.values()])

export type Globals = LayerNode.Output<typeof globalsGraph>
export type GlobalsError = LayerNode.Error<typeof globalsGraph>

export interface Options {
  // Plugins this instance is born with; empty and absent are equivalent.
  readonly plugins?: InstancePlugins.List
  // Filesystem config discovery; true (default) is today's behavior. When
  // false the instance boots vanilla: no upward config scan, no global config
  // dir, no plugin-dir loading or ambient plugin module imports, no boot-time
  // AGENTS.md discovery. Wellknown integration config and host-injected values
  // still apply, and a config value that explicitly names something
  // file-backed (a skill path, an MCP command) is a request, not discovery.
  // Use-triggered behavior also stays: reading a file still injects nested
  // AGENTS.md instructions — that is session-time context, not boot-time
  // population.
  readonly discovery?: boolean
  readonly replacements?: LayerNode.Replacements
}

// Vanilla neutralizes the discovery inputs; the plugin list stays untouched.
// These are defaults ahead of caller replacements: a host that replaces a
// gated node itself owns that node's discovery flags. Plugin-directory
// discovery needs no swap here — implicit scanning only triggers on Directory
// config entries, which a no-scan Config never produces, and the default
// source still honors explicit plugin operations from wellknown and
// host-injected config.
const vanillaReplacements: LayerNode.Replacements = [
  [Config.node, Config.configured({ project: false, global: false })],
  [InstructionDiscovery.node, InstructionDiscovery.configured({ project: false, global: false })],
]

/**
 * Reuse already-acquired host infrastructure while giving each instance fresh
 * local services. Global replacements belong on globalsGraph; local replacements
 * and a closed per-instance PluginRuntime replacement belong here.
 */
export function compose<const Items extends LayerNode.Replacements = readonly []>(
  ref: Location.Ref,
  options: Omit<Options, "replacements"> & { readonly replacements?: LayerNode.ComposableReplacements<Items> } = {},
): Layer.Layer<Services, Error | LayerNode.ReplacementError<Items>, Globals | LayerNode.ReplacementServices<Items>> {
  const startedAt = performance.now()
  const replacements: LayerNode.Replacements = [
    ...(options.discovery === false ? vanillaReplacements : []),
    ...(options.replacements ?? []),
    [Location.node, Location.boundNode(ref, { discovery: options.discovery })],
    [InstancePlugins.node, InstancePlugins.bound(options.plugins ?? [])],
  ]
  const hoisted = LayerNode.hoist(graph, Node.tags.values.global, replacements).hoisted
  // PluginRuntime itself is local to a direct instance, but a node replacement
  // can still depend on shared globals. Inspect those edges before binding them.
  const boundary = LayerNode.hoist(
    LayerNode.group(
      hoisted.dependencies.flatMap((node) => (node.name === PluginRuntime.node.name ? node.dependencies : [node])),
    ),
    Node.tags.values.global,
  ).hoisted
  const names = new Set(globalNodes.map((node) => node.name))
  const unsupported = boundary.dependencies.filter((node) => !names.has(node.name) && !globalJobs.has(node.name))
  if (unsupported.length > 0) {
    throw new Error(`Unsupported instance globals: ${unsupported.map((node) => node.name).join(", ")}`)
  }

  return Layer.unwrap(
    Effect.map(Effect.context<Globals>(), (globals) => {
      const owner = Symbol()
      const captured = Layer.succeedContext(
        globals.pipe(
          Context.add(Bus.PrivateOwner, owner),
          Context.add(Bus.Service, Bus.capture(Context.get(globals, Bus.Service), owner)),
        ),
      )
      const bindings: LayerNode.Replacements = boundary.dependencies.map((node) => [
        node,
        globalJobs.has(node.name) ? Layer.empty : captured,
      ])
      // Compile the original graph with real closed implementations, not the
      // dependency-stripped hoist result that cannot honestly be a closed layer.
      return LayerNode.compile(graph, [...replacements, ...bindings]).pipe(
        Layer.fresh,
        Layer.tap(() =>
          Effect.logInfo("location services booted", {
            directory: ref.directory,
            workspaceID: ref.workspaceID,
            durationMs: Math.round(performance.now() - startedAt),
          }),
        ),
      )
    }),
  )
}

// One instance is one compiled, fresh copy of the graph standing on a directory.
export function layer(ref: Location.Ref, options: Options = {}) {
  const startedAt = performance.now()
  // Ordered: vanilla defaults, then caller replacements (which win over the
  // defaults), then bound pairs (which win over everything).
  const allReplacements: LayerNode.Replacements = [
    ...(options.discovery === false ? vanillaReplacements : []),
    ...(options.replacements ?? []),
    [Location.node, Location.boundNode(ref, { discovery: options.discovery })],
    [InstancePlugins.node, InstancePlugins.bound(options.plugins ?? [])],
  ]
  // Apply replacements during hoist, not afterward: replacements can
  // introduce new tagged dependencies (Location.boundNode depends on
  // Project), and the hoist walk is the only pass that can still slice
  // those back out.
  const location = LayerNode.hoist(graph, Node.tags.values.global, allReplacements)

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
}
