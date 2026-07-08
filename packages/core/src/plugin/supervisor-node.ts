export * as PluginSupervisorNode from "./supervisor-node"

import { AgentV2 } from "../agent"
import { Catalog } from "../catalog"
import { CommandV2 } from "../command"
import { Config } from "../config"
import { httpClient } from "../effect/app-node-platform"
import { makeLocationNode } from "../effect/app-node"
import { EventV2 } from "../event"
import { FileMutation } from "../file-mutation"
import { FileSystem } from "../filesystem"
import { FSUtil } from "../fs-util"
import { Form } from "../form"
import { Global } from "../global"
import { Image } from "../image"
import { Integration } from "../integration"
import { Location } from "../location"
import { LocationMutation } from "../location-mutation"
import { ModelsDev } from "../models-dev"
import { Npm } from "../npm"
import { PermissionV2 } from "../permission"
import { PluginV2 } from "../plugin"
import { Reference } from "../reference"
import { Ripgrep } from "../ripgrep"
import { SessionInstructions } from "../session/instructions"
import { SessionTodo } from "../session/todo"
import { Shell } from "../shell"
import { SkillV2 } from "../skill"
import { ReadToolFileSystem } from "../tool/read-filesystem"
import { ToolRegistry } from "../tool/registry"
import { WebSearchTool } from "../tool/websearch"
import { Layer } from "effect"
import { PluginRuntime } from "./runtime"
import type { PluginInternal } from "./internal"
import { SdkPlugins } from "./sdk"
import { PluginSupervisor } from "./supervisor"

const layer = PluginSupervisor.layer as Layer.Layer<PluginSupervisor.Service, never, PluginInternal.Requirements>

export const node = makeLocationNode({
  service: PluginSupervisor.Service,
  layer,
  deps: [
    PluginV2.node,
    SdkPlugins.node,
    AgentV2.node,
    Catalog.node,
    CommandV2.node,
    Config.node,
    EventV2.node,
    FileMutation.node,
    FileSystem.node,
    FSUtil.node,
    Global.node,
    httpClient,
    Image.node,
    Integration.node,
    Location.node,
    LocationMutation.node,
    ModelsDev.node,
    Npm.node,
    PermissionV2.node,
    PluginRuntime.node,
    Form.node,
    ReadToolFileSystem.node,
    Reference.node,
    Ripgrep.node,
    SessionInstructions.node,
    SessionTodo.node,
    Shell.node,
    SkillV2.node,
    ToolRegistry.toolsNode,
    WebSearchTool.configNode,
  ],
})
