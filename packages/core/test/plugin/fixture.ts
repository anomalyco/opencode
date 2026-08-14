import { AgentV2 } from "@moks/core/agent"
import { AISDK } from "@moks/core/aisdk"
import { Catalog } from "@moks/core/catalog"
import { CommandV2 } from "@moks/core/command"
import { Credential } from "@moks/core/credential"
import { AppNodeBuilder } from "@moks/core/effect/app-node-builder"
import { LayerNodePlatform } from "@moks/core/effect/app-node-platform"
import { LayerNode } from "@moks/core/effect/layer-node"
import { EventV2 } from "@moks/core/event"
import { FileSystem } from "@moks/core/filesystem"
import { FSUtil } from "@moks/core/fs-util"
import { Integration } from "@moks/core/integration"
import { Location } from "@moks/core/location"
import { Npm } from "@moks/core/npm"
import { PluginV2 } from "@moks/core/plugin"
import { Reference } from "@moks/core/reference"
import { SkillV2 } from "@moks/core/skill"
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
