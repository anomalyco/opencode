import { Agent } from "@Mackery6969/core/agent"
import { Artifact } from "@Mackery6969/core/artifact"
import { AISDK } from "@Mackery6969/core/aisdk"
import { Command } from "@Mackery6969/core/command"
import { Config } from "@Mackery6969/core/config"
import { Credential } from "@Mackery6969/core/credential"
import { Database } from "@Mackery6969/core/database/database"
import { Environment } from "@Mackery6969/core/environment/index"
import { FileAccess } from "@Mackery6969/core/file-access"
import { LayerNodePlatform } from "@Mackery6969/util/effect/app-node-platform"
import { AppProcess } from "@Mackery6969/util/process"
import { LayerNode } from "@Mackery6969/util/effect/layer-node"
import { Bus } from "@Mackery6969/core/bus"
import { FileSystem } from "@Mackery6969/core/filesystem"
import { FSUtil } from "@Mackery6969/util/fs-util"
import { Global } from "@Mackery6969/util/global"
import { Form } from "@Mackery6969/core/form"
import { Generate } from "@Mackery6969/core/generate"
import { InstructionDiscovery } from "@Mackery6969/core/instruction-discovery"
import { Integration } from "@Mackery6969/core/integration"
import { Job } from "@Mackery6969/core/job"
import { KV } from "@Mackery6969/core/kv"
import { Location } from "@Mackery6969/core/location"
import { Mcp } from "@Mackery6969/core/mcp/index"
import { Model } from "@Mackery6969/core/model"
import { Npm } from "@Mackery6969/util/npm"
import { Plugin } from "@Mackery6969/core/plugin"
import { PluginHooks } from "@Mackery6969/core/plugin/hooks"
import { Provider } from "@Mackery6969/core/provider"
import { Session } from "@Mackery6969/core/session"
import { SharedCache } from "@Mackery6969/core/shared-cache"
import { InstructionEntry } from "@Mackery6969/core/session/instruction-entry"
import { PersistentPty } from "@Mackery6969/core/persistent-pty"
import { LocationServiceMap } from "@Mackery6969/core/location-service-map"
import { AppNodeBuilder } from "@Mackery6969/core/effect/app-node-builder"
import { Permission } from "@Mackery6969/core/permission"
import { Reference } from "@Mackery6969/core/reference"
import { Rpc } from "@Mackery6969/core/rpc"
import { Skill } from "@Mackery6969/core/skill"
import { SkillDiscovery } from "@Mackery6969/core/skill/discovery"
import { Watcher } from "@Mackery6969/core/filesystem/watcher"
import { Tool } from "@Mackery6969/core/tool"
import { Vcs } from "@Mackery6969/core/vcs"
import { WebSearch } from "@Mackery6969/core/websearch"
import { Worktree } from "@Mackery6969/core/worktree"
import { WorktreeStrategies } from "@Mackery6969/core/worktree/strategies"
import { Effect, Layer } from "effect"
import { tempLocationLayer } from "../fixture/location"
import { emptyMcpLayer } from "../fixture/mcp"
import { offlineModels } from "../fixture/models"

const npmLayer = Layer.succeed(
  Npm.Service,
  Npm.Service.of({
    add: (name) => Effect.succeed({ directory: "", name }),
    resolve: (name) => Effect.succeed({ directory: "", name }),
    check: () => Effect.succeed(false),
    update: (name) => Effect.succeed({ directory: "", name }),
    which: () => Effect.undefined,
  }),
)

const generateLayer = Layer.succeed(
  Generate.Service,
  Generate.Service.of({
    text: () => Effect.succeed(""),
    image: () => Effect.die("unused"),
    decisions: () => Effect.die("unused"),
  }),
)

const configLayer = Config.testLayer()

const permissionLayer = Layer.succeed(
  Permission.Service,
  Permission.Service.of({
    close: Effect.void,
    ask: (input) => Effect.succeed({ id: input.id ?? Permission.ID.create(), effect: "ask" }),
    assert: () => Effect.void,
    assertNotDenied: () => Effect.void,
    allows: () => Effect.succeed(false),
    reply: () => Effect.void,
    get: () => Effect.succeed(undefined),
    forSession: () => Effect.succeed([]),
    list: () => Effect.succeed([]),
  }),
)

export const makePluginTestLayer = (permission = permissionLayer, generate = generateLayer) =>
  AppNodeBuilder.build(
    LayerNode.group([
      AppProcess.node,
      FileSystem.node,
      FSUtil.node,
      Location.node,
      Npm.node,
      Credential.node,
      Config.node,
      Database.node,
      Environment.node,
      FileAccess.node,
      Global.node,
      Bus.node,
      Form.node,
      Generate.node,
      LayerNodePlatform.httpClient,
      Plugin.node,
      Agent.node,
      Artifact.node,
      AISDK.node,
      Provider.node,
      Model.node,
      Command.node,
      InstructionDiscovery.node,
      Integration.node,
      Job.node,
      KV.node,
      Mcp.node,
      Session.node,
      SharedCache.node,
      InstructionEntry.node,
      PersistentPty.node,
      LocationServiceMap.node,
      Permission.node,
      PluginHooks.node,
      Reference.node,
      Rpc.node,
      Skill.node,
      SkillDiscovery.node,
      Tool.node,
      Vcs.node,
      Watcher.node,
      WebSearch.node,
      Worktree.node,
      WorktreeStrategies.node,
    ]),
    [
      Location.node.replace(tempLocationLayer),
      Npm.node.replace(npmLayer),
      Config.node.replace(configLayer),
      Mcp.node.replace(emptyMcpLayer),
      Generate.node.replace(generate),
      Permission.node.replace(permission),
      offlineModels,
    ],
  ).pipe(Layer.provideMerge(configLayer))

export const PluginTestLayer = makePluginTestLayer()
