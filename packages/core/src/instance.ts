import { Effect, Layer } from "effect"
import { Agent } from "./agent.js"
import { AISDK } from "./aisdk.js"
import { Catalog } from "./catalog.js"
import { Command } from "./command.js"
import { Config } from "./config.js"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Node } from "@opencode-ai/util/effect/app-node"
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
import { ModelResolver } from "./model-resolver.js"
import { Mcp } from "./mcp/index.js"
import { Permission } from "./permission.js"
import { Plugin } from "./plugin.js"
import { PluginHooks } from "./plugin/hooks.js"
import { InstancePlugins } from "./plugin/instance.js"
import { PluginSupervisor } from "./plugin/supervisor.js"
import { WorktreeRefresh } from "./worktree/refresh.js"
import { Worktree } from "./worktree.js"
import { Pty } from "./pty.js"
import { Shell } from "./shell.js"
import { ShellSelect } from "./shell/select.js"
import { Reference } from "./reference.js"
import { Rpc } from "./rpc.js"
import { WebSearch } from "./websearch.js"
import { ReferenceInstructions } from "./reference/instructions.js"
import { SessionRunnerLLM } from "./session/runner/llm.js"
import { SessionRunnerModel } from "./session/runner/model.js"
import { SessionCompaction } from "./session/compaction.js"
import { SessionTitle } from "./session/title.js"
import { SessionContext } from "./session/context.js"
import { Skill } from "./skill.js"
import { SkillInstructions } from "./skill/instructions.js"
import { Snapshot } from "./snapshot.js"
import { InstructionDiscovery } from "./instruction-discovery.js"
import { InstructionBuiltIns } from "./instructions/builtins.js"
import { InstructionEntry } from "./session/instruction-entry.js"
import { SessionInstructions } from "./session/instructions.js"
import { McpTool } from "./tool/mcp.js"
import { ReadToolFileSystem } from "./tool/read-filesystem.js"
import { Tool } from "./tool.js"
import { ToolOutput } from "./tool-output.js"
import { Vcs } from "./vcs.js"

export * as Instance from "./instance.js"
export { Service, node, type Interface } from "./instance/service.js"

const nodes = [
  Location.node,
  Environment.node,
  Config.node,
  Agent.node,
  Command.node,
  Reference.node,
  Rpc.node,
  WebSearch.node,
  Integration.node,
  Catalog.node,
  ModelResolver.node,
  AISDK.node,
  Plugin.node,
  PluginHooks.node,
  InstancePlugins.node,
  PluginSupervisor.node,
  WorktreeRefresh.node,
  Worktree.node,
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
  ReadToolFileSystem.node,
  McpTool.node,
  SessionInstructions.node,
  SessionRunnerModel.node,
  SessionCompaction.node,
  SessionTitle.node,
  SessionContext.node,
  Snapshot.node,
  SessionRunnerLLM.node,
  Vcs.node,
  // Start repository watches only after boot-critical filesystem and Git work.
  LocationWatcher.node,
] as const satisfies readonly Node.LocationGraph<never, unknown>[]

export const graph = LayerNode.group(nodes)

export type Services = LayerNode.Output<typeof graph>
export type Error = Layer.Error<ReturnType<typeof layer>>

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
  Config.node.replace(Config.configured({ project: false, global: false })),
  InstructionDiscovery.node.replace(InstructionDiscovery.configured({ project: false, global: false })),
]

// One instance is one compiled, fresh copy of the graph standing on a directory.
export function layer(ref: Location.Ref, options: Options = {}): Layer.Layer<Services> {
  const startedAt = performance.now()
  // Ordered: vanilla defaults, then caller replacements (which win over the
  // defaults), then instance bindings (which win over everything).
  const replacements: LayerNode.Replacements = [
    ...(options.discovery === false ? vanillaReplacements : []),
    ...(options.replacements ?? []),
    Location.node.replace(Location.boundNode(ref, { discovery: options.discovery })),
    InstancePlugins.node.replace(InstancePlugins.bound(options.plugins ?? [])),
  ]

  return LayerNode.compile(graph, { replacements, shared: Node.tags.values.global }).pipe(
    // Instance boot failures are defects; provided operations retain their typed errors.
    Layer.orDie,
    Layer.tap(() =>
      Effect.logInfo("location services booted", {
        directory: ref.directory,
        workspaceID: ref.workspaceID,
        durationMs: Math.round(performance.now() - startedAt),
      }),
    ),
  )
}
