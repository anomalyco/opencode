import { AgentV2 } from "@leak-code/core/agent"
import { AISDK } from "@leak-code/core/aisdk"
import { Catalog } from "@leak-code/core/catalog"
import { CommandV2 } from "@leak-code/core/command"
import { Credential } from "@leak-code/core/credential"
import { AppNodeBuilder } from "@leak-code/core/effect/app-node-builder"
import { LayerNodePlatform } from "@leak-code/core/effect/app-node-platform"
import { LayerNode } from "@leak-code/core/effect/layer-node"
import { EventV2 } from "@leak-code/core/event"
import { FileSystem } from "@leak-code/core/filesystem"
import { FSUtil } from "@leak-code/core/fs-util"
import { Integration } from "@leak-code/core/integration"
import { Location } from "@leak-code/core/location"
import { Npm } from "@leak-code/core/npm"
import { PluginV2 } from "@leak-code/core/plugin"
import { Reference } from "@leak-code/core/reference"
import { SkillV2 } from "@leak-code/core/skill"
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

export const PluginTestLayer = AppNodeBuilder.build(
  LayerNode.group([
    FileSystem.node,
    FSUtil.node,
    Location.node,
    Npm.node,
    Credential.node,
    EventV2.node,
    LayerNodePlatform.httpClient,
    PluginV2.node,
    AgentV2.node,
    AISDK.node,
    Catalog.node,
    CommandV2.node,
    Integration.node,
    Reference.node,
    SkillV2.node,
  ]),
  [
    [Location.node, tempLocationLayer],
    [Npm.node, npmLayer],
  ],
)
