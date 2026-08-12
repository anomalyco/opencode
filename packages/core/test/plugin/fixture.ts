import { Agent } from "@opencode-ai/core/agent"
import { AISDK } from "@opencode-ai/core/aisdk"
import { Catalog } from "@opencode-ai/core/catalog"
import { Command } from "@opencode-ai/core/command"
import { Config } from "@opencode-ai/core/config"
import { Credential } from "@opencode-ai/core/credential"
import { LayerNodePlatform } from "@opencode-ai/util/effect/app-node-platform"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { Bus } from "@opencode-ai/core/bus"
import { FileSystem } from "@opencode-ai/core/filesystem"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Form } from "@opencode-ai/core/form"
import { Integration } from "@opencode-ai/core/integration"
import { Location } from "@opencode-ai/core/location"
import { Npm } from "@opencode-ai/util/npm"
import { Plugin } from "@opencode-ai/core/plugin"
import { PluginHooks } from "@opencode-ai/core/plugin/hooks"
import { PluginRuntime } from "@opencode-ai/core/plugin/runtime"
import { Reference } from "@opencode-ai/core/reference"
import { Skill } from "@opencode-ai/core/skill"
import { SkillDiscovery } from "@opencode-ai/core/skill/discovery"
import { Watcher } from "@opencode-ai/core/filesystem/watcher"
import { Tool } from "@opencode-ai/core/tool"
import { WebSearch } from "@opencode-ai/core/websearch"
import { Effect, Layer } from "effect"
import { tempLocationLayer } from "../fixture/location"

const npmLayer = Layer.succeed(
  Npm.Service,
  Npm.Service.of({
    add: () => Effect.succeed({ directory: "", entrypoint: undefined }),
    install: () => Effect.void,
    which: () => Effect.succeed(undefined),
  }),
)

export const PluginTestLayer = LayerNode.compile(
  LayerNode.group([
    FileSystem.node,
    FSUtil.node,
    Location.node,
    Npm.node,
    Credential.node,
    Bus.node,
    Form.node,
    LayerNodePlatform.httpClient,
    Plugin.node,
    Agent.node,
    AISDK.node,
    Catalog.node,
    Command.node,
    Integration.node,
    PluginRuntime.node,
    PluginHooks.node,
    Reference.node,
    Skill.node,
    SkillDiscovery.node,
    PluginHooks.node,
    Tool.node,
    Watcher.node,
    WebSearch.node,
  ]),
  [
    [Location.node, tempLocationLayer],
    [Npm.node, npmLayer],
    [Config.node, Config.testLayer()],
  ],
) as unknown as Layer.Layer<unknown, never>
