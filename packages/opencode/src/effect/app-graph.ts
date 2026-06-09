import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { Account } from "@/account/account"
import { AccountRepo } from "@/account/repo"
import { Agent } from "@/agent/agent"
import { Auth } from "@/auth"
import { BackgroundJob } from "@/background/job"
import { Command } from "@/command"
import { Config } from "@/config/config"
import { Workspace } from "@/control-plane/workspace"
import { Env } from "@/env"
import { EventV2Bridge } from "@/event-v2-bridge"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Format } from "@/format"
import { Git } from "@/git"
import { Image } from "@/image/image"
import { Installation } from "@/installation"
import { LSP } from "@/lsp/lsp"
import { MCP } from "@/mcp"
import { McpAuth } from "@/mcp/auth"
import { Permission } from "@/permission"
import { Plugin } from "@/plugin"
import { InstanceBootstrap } from "@/project/bootstrap"
import { InstanceStore } from "@/project/instance-store"
import { Project } from "@/project/project"
import { Vcs } from "@/project/vcs"
import { ProviderAuth } from "@/provider/auth"
import { Provider } from "@/provider/provider"
import { Question } from "@/question"
import { Reference } from "@/reference/reference"
import { RepositoryCache } from "@/reference/repository-cache"
import { SessionCompaction } from "@/session/compaction"
import { Instruction } from "@/session/instruction"
import { LLM } from "@/session/llm"
import { SessionProcessor } from "@/session/processor"
import { SessionPrompt } from "@/session/prompt"
import { SessionRevert } from "@/session/revert"
import { SessionRunState } from "@/session/run-state"
import { Session } from "@/session/session"
import { SessionStatus } from "@/session/status"
import { SessionSummary } from "@/session/summary"
import { SystemPrompt } from "@/session/system"
import { Todo } from "@/session/todo"
import { SessionShare } from "@/share/session"
import { ShareNext } from "@/share/share-next"
import { Skill } from "@/skill"
import { Discovery } from "@/skill/discovery"
import { Snapshot } from "@/snapshot"
import { Storage } from "@/storage/storage"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import { Worktree } from "@/worktree"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { EffectFlock } from "@opencode-ai/core/util/effect-flock"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Git as GitV2 } from "@opencode-ai/core/git"
import { Global } from "@opencode-ai/core/global"
import { ModelsDev } from "@opencode-ai/core/models-dev"
import { Npm } from "@opencode-ai/core/npm"
import { AppProcess } from "@opencode-ai/core/process"
import { Project as ProjectV2 } from "@opencode-ai/core/project"
import { ProjectCopy } from "@opencode-ai/core/project/copy"
import { PtyTicket } from "@opencode-ai/core/pty/ticket"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { Ripgrep } from "@opencode-ai/core/filesystem/ripgrep"
import { FetchHttpClient } from "effect/unstable/http"
import { LLMClient, RequestExecutor } from "@opencode-ai/llm/route"
import { Layer } from "effect"

type RuntimeLayer = Layer.Layer<never, unknown, unknown>
type AnyNode = Node<unknown, unknown>
type NodeList = readonly [] | readonly [AnyNode, ...AnyNode[]]
type Output<Item> = [Item] extends [never] ? never : Item extends Node<infer A, any> ? A : never
type Error<Item> = [Item] extends [never] ? never : Item extends Node<any, infer E> ? E : never
type Missing<Required, Dependencies extends NodeList> = Exclude<Required, Output<Dependencies[number]>>
type CheckDependencies<Implementation extends Layer.Any, Dependencies extends NodeList> = [
  Missing<Layer.Services<Implementation>, Dependencies>,
] extends [never]
  ? unknown
  : { readonly "Missing dependencies": Missing<Layer.Services<Implementation>, Dependencies> }
declare const $OutputType: unique symbol
declare const $ErrorType: unique symbol

export type Node<A, E = never> = {
  readonly kind: "layer" | "group"
  readonly implementation?: Layer.Any
  readonly dependencies: readonly AnyNode[]
  readonly [$OutputType]?: () => A
  readonly [$ErrorType]?: () => E
}

export function node<const Implementation extends Layer.Any, const Items extends NodeList>(
  implementation: Implementation,
  dependencies: Items & CheckDependencies<Implementation, NoInfer<Items>>,
): Node<Layer.Success<Implementation>, Layer.Error<Implementation> | Error<Items[number]>> {
  return { kind: "layer", implementation: implementation as Layer.Any, dependencies }
}

export function group<const Items extends NodeList>(
  dependencies: Items,
): Node<Output<Items[number]>, Error<Items[number]>> {
  return { kind: "group", dependencies }
}

export type Replacement<A = unknown> = {
  readonly source: Node<A, unknown>
  readonly replacement: Node<A, unknown>
}

type CheckReplacementErrors<SourceError, ReplacementError> = [Exclude<ReplacementError, SourceError>] extends [never]
  ? unknown
  : { readonly "New replacement errors": Exclude<ReplacementError, SourceError> }

export function replace<A, E, E2>(
  source: Node<A, E>,
  replacement: Node<NoInfer<A>, E2> & CheckReplacementErrors<E, NoInfer<E2>>,
): Replacement<A> {
  return { source, replacement }
}

export function build<A, E>(node: Node<A, E>, options?: { readonly replacements?: readonly Replacement[] }) {
  const replacements = new Map(options?.replacements?.map((item) => [item.source, item.replacement]))
  const cache = new Map<AnyNode, RuntimeLayer>()
  const visiting = new Set<AnyNode>()
  const stack: AnyNode[] = []
  const ids = new Map<AnyNode, number>()

  const visit = (input: AnyNode): RuntimeLayer => {
    const node = replacements.get(input) ?? input
    const cached = cache.get(node)
    if (cached) return cached
    if (visiting.has(node)) {
      const start = stack.indexOf(node)
      const cycle = [...stack.slice(start), node]
        .map((item) => `${item.kind}#${ids.get(item)}`)
        .join(" -> ")
      throw new Error(`Cycle detected in app graph: ${cycle}`)
    }
    if (!ids.has(node)) ids.set(node, ids.size + 1)
    visiting.add(node)
    stack.push(node)
    try {
      const dependencies = node.dependencies.map(visit)
      const nonEmpty = dependencies as [RuntimeLayer, ...RuntimeLayer[]]
      const result =
        node.kind === "group"
          ? dependencies.length === 0
            ? Layer.empty
            : Layer.mergeAll(...nonEmpty)
          : dependencies.length === 0
            ? (node.implementation as RuntimeLayer)
            : Layer.provide(node.implementation as RuntimeLayer, nonEmpty)
      cache.set(node, result)
      return result
    } finally {
      stack.pop()
      visiting.delete(node)
    }
  }

  return visit(node) as unknown as Layer.Layer<A, E, never>
}

// Platform and process-global leaves
export const nodeFileSystem = node(NodeFileSystem.layer, [])

export const nodePath = node(NodePath.layer, [])

export const httpClient = node(FetchHttpClient.layer, [])

export const childProcessSpawner = node(CrossSpawnSpawner.layer, [nodeFileSystem, nodePath])

export const global = node(Global.layer, [])

export const database = node(Database.layerFromPath(Database.path()), [])

export const env = node(Env.layer, [])

export const runtimeFlags = node(RuntimeFlags.defaultLayer, [])

export const backgroundJob = node(BackgroundJob.layer, [])

export const ptyTicket = node(PtyTicket.layer, [])

export const requestExecutor = node(RequestExecutor.layer, [httpClient])

export const llmClient = node(LLMClient.layer, [requestExecutor])

// Foundational services
export const fs = node(FSUtil.layer, [nodeFileSystem])

export const appProcess = node(AppProcess.layer, [childProcessSpawner])

export const events = node(EventV2.layer, [database])

export const eventBridge = node(EventV2Bridge.layer, [events])

export const sessionProjector = node(SessionProjector.layer, [events, database])

export const effectFlock = node(EffectFlock.layer, [global, fs])

export const auth = node(Auth.layer, [fs])

export const accountRepo = node(AccountRepo.layer, [database])

export const account = node(Account.layer, [accountRepo, httpClient])

export const discovery = node(Discovery.layer, [fs, nodePath, httpClient])

export const ripgrep = node(Ripgrep.layer, [fs, childProcessSpawner, httpClient])

export const git = node(Git.layer, [appProcess])

export const gitV2 = node(GitV2.layer, [fs, appProcess])

export const npm = node(Npm.layer, [fs, global, nodeFileSystem, effectFlock])

export const modelsDev = node(ModelsDev.layer, [fs, events, httpClient])

export const installation = node(Installation.layer, [httpClient, appProcess])

export const storage = node(Storage.layer, [fs, git])

export const projectV2 = node(ProjectV2.layer, [database, fs, gitV2])

export const projectCopy = node(ProjectCopy.layer, [fs, gitV2, events, database])

export const config = node(Config.layer, [fs, auth, account, env, npm, httpClient])

export const permission = node(Permission.layer, [eventBridge])

export const todo = node(Todo.layer, [eventBridge, database])

export const question = node(Question.layer, [eventBridge])

export const sessionStatus = node(SessionStatus.layer, [eventBridge])

export const sessionRunState = node(SessionRunState.layer, [backgroundJob, sessionStatus])

export const truncate = node(Truncate.layer, [fs])

export const mcpAuth = node(McpAuth.layer, [fs, effectFlock])

// Instance-aware application services
export const project = node(Project.layer, [
  fs,
  appProcess,
  childProcessSpawner,
  projectV2,
  projectCopy,
  eventBridge,
  runtimeFlags,
  database,
])

export const vcs = node(Vcs.layer, [git, eventBridge])

export const session = node(Session.layer, [backgroundJob, runtimeFlags, database, eventBridge])

export const plugin = node(Plugin.layer, [eventBridge, config, runtimeFlags])

export const format = node(Format.layer, [config, appProcess, runtimeFlags])

export const snapshot = node(Snapshot.layer, [fs, appProcess, config])

export const lsp = node(LSP.layer, [config, runtimeFlags, fs, eventBridge])

export const mcp = node(MCP.layer, [childProcessSpawner, mcpAuth, eventBridge, config])

export const skill = node(Skill.layer, [discovery, config, eventBridge, fs, global, runtimeFlags])

export const instruction = node(Instruction.layer, [config, fs, global, runtimeFlags, httpClient])

export const image = node(Image.layer, [config])

export const repositoryCache = node(RepositoryCache.layer, [fs, git])

export const reference = node(Reference.layer, [config, repositoryCache, runtimeFlags])

export const provider = node(Provider.layer, [fs, config, auth, env, plugin, modelsDev, runtimeFlags])

export const providerAuth = node(ProviderAuth.layer, [auth, plugin])

export const agent = node(Agent.layer, [config, auth, plugin, skill, provider])

export const command = node(Command.layer, [config, mcp, skill])

export const llm = node(LLM.layer, [
  auth,
  config,
  provider,
  plugin,
  permission,
  eventBridge,
  llmClient,
  runtimeFlags,
])

export const systemPrompt = node(SystemPrompt.layer, [skill])

export const sessionSummary = node(SessionSummary.layer, [session, snapshot, eventBridge, config])

export const shareNext = node(ShareNext.layer, [
  account,
  eventBridge,
  config,
  database,
  httpClient,
  provider,
  session,
])

export const sessionShare = node(SessionShare.layer, [config, session, shareNext, runtimeFlags])

export const sessionRevert = node(SessionRevert.layer, [
  session,
  snapshot,
  storage,
  eventBridge,
  sessionSummary,
  sessionRunState,
])

export const sessionProcessor = node(SessionProcessor.layer, [
  session,
  config,
  snapshot,
  agent,
  llm,
  permission,
  plugin,
  sessionSummary,
  sessionStatus,
  image,
  eventBridge,
  runtimeFlags,
  database,
])

export const sessionCompaction = node(SessionCompaction.layer, [
  config,
  session,
  agent,
  plugin,
  sessionProcessor,
  provider,
  eventBridge,
  runtimeFlags,
])

export const toolRegistry = node(ToolRegistry.layer, [
  config,
  plugin,
  question,
  todo,
  agent,
  skill,
  session,
  backgroundJob,
  provider,
  reference,
  lsp,
  instruction,
  fs,
  eventBridge,
  httpClient,
  childProcessSpawner,
  ripgrep,
  format,
  truncate,
  runtimeFlags,
  database,
])

export const sessionPrompt = node(SessionPrompt.layer, [
  sessionStatus,
  session,
  agent,
  provider,
  sessionProcessor,
  sessionCompaction,
  plugin,
  command,
  config,
  permission,
  fs,
  mcp,
  lsp,
  toolRegistry,
  truncate,
  image,
  childProcessSpawner,
  instruction,
  sessionRunState,
  sessionRevert,
  sessionSummary,
  systemPrompt,
  llm,
  reference,
  eventBridge,
  runtimeFlags,
  database,
])

export const workspace = node(Workspace.layer, [
  auth,
  session,
  sessionPrompt,
  httpClient,
  eventBridge,
  vcs,
  runtimeFlags,
  fs,
  database,
])

export const instanceBootstrap = node(InstanceBootstrap.layer, [
  config,
  format,
  lsp,
  plugin,
  project,
  reference,
  shareNext,
  snapshot,
  vcs,
])

export const instanceStore = node(InstanceStore.layer, [project, instanceBootstrap])

export const worktree = node(Worktree.layer, [
  fs,
  nodePath,
  appProcess,
  git,
  project,
  instanceStore,
  database,
])

export const app = group([
  npm,
  fs,
  database,
  auth,
  account,
  config,
  git,
  ripgrep,
  storage,
  snapshot,
  plugin,
  modelsDev,
  provider,
  providerAuth,
  agent,
  skill,
  discovery,
  question,
  permission,
  todo,
  session,
  sessionProjector,
  sessionStatus,
  backgroundJob,
  runtimeFlags,
  eventBridge,
  sessionRunState,
  sessionProcessor,
  sessionCompaction,
  sessionRevert,
  sessionSummary,
  sessionPrompt,
  instruction,
  llm,
  lsp,
  mcp,
  mcpAuth,
  command,
  truncate,
  toolRegistry,
  format,
  project,
  vcs,
  reference,
  workspace,
  worktree,
  installation,
  shareNext,
  sessionShare,
  instanceStore,
])
