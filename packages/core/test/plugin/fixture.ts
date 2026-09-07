import { Agent } from "@opencode-ai/core/agent"
import { AISDK } from "@opencode-ai/core/aisdk"
import { Catalog } from "@opencode-ai/core/catalog"
import { Command } from "@opencode-ai/core/command"
import { Config } from "@opencode-ai/core/config"
import { Credential } from "@opencode-ai/core/credential"
import { LayerNodePlatform } from "@opencode-ai/util/effect/app-node-platform"
import { AppProcess } from "@opencode-ai/util/process"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Bus } from "@opencode-ai/core/bus"
import { FileSystem } from "@opencode-ai/core/filesystem"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Form } from "@opencode-ai/core/form"
import { Generate } from "@opencode-ai/core/generate"
import { Integration } from "@opencode-ai/core/integration"
import { KV } from "@opencode-ai/core/kv"
import { Location } from "@opencode-ai/core/location"
import { Mcp } from "@opencode-ai/core/mcp/index"
import { Npm } from "@opencode-ai/util/npm"
import { Plugin } from "@opencode-ai/core/plugin"
import { PluginHooks } from "@opencode-ai/core/plugin/hooks"
import { Session } from "@opencode-ai/core/session"
import { PersistentPty } from "@opencode-ai/core/persistent-pty"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Permission } from "@opencode-ai/core/permission"
import { Reference } from "@opencode-ai/core/reference"
import { Rpc } from "@opencode-ai/core/rpc"
import { Skill } from "@opencode-ai/core/skill"
import { SkillDiscovery } from "@opencode-ai/core/skill/discovery"
import { Watcher } from "@opencode-ai/core/filesystem/watcher"
import { Tool } from "@opencode-ai/core/tool"
import { Vcs } from "@opencode-ai/core/vcs"
import { WebSearch } from "@opencode-ai/core/websearch"
import { Worktree } from "@opencode-ai/core/worktree"
import { Effect, Layer } from "effect"
import { tempLocationLayer } from "../fixture/location"
import { emptyMcpLayer } from "../fixture/mcp"

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

const generateLayer = Layer.succeed(Generate.Service, Generate.Service.of({ text: () => Effect.succeed("") }))

const permissionLayer = Layer.succeed(
  Permission.Service,
  Permission.Service.of({
    ask: (input) => Effect.succeed({ id: input.id ?? Permission.ID.create(), effect: "ask" }),
    assert: () => Effect.void,
    reply: () => Effect.void,
    get: () => Effect.succeed(undefined),
    forSession: () => Effect.succeed([]),
    list: () => Effect.succeed([]),
  }),
)

export const PluginTestLayer = AppNodeBuilder.build(
  LayerNode.group([
    AppProcess.node,
    FileSystem.node,
    FSUtil.node,
    Location.node,
    Npm.node,
    Credential.node,
    Bus.node,
    Form.node,
    Generate.node,
    LayerNodePlatform.httpClient,
    Plugin.node,
    Agent.node,
    AISDK.node,
    Catalog.node,
    Command.node,
    Integration.node,
    KV.node,
    Mcp.node,
    Session.node,
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
  ]),
  [
    Location.node.replace(tempLocationLayer),
    Npm.node.replace(npmLayer),
    Config.node.replace(Config.testLayer()),
    Mcp.node.replace(emptyMcpLayer),
    Generate.node.replace(generateLayer),
    Permission.node.replace(permissionLayer),
  ],
)
