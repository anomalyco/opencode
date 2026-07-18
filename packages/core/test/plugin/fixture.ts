import { AgentV2 } from "@kancode/core/agent"
import { AISDK } from "@kancode/core/aisdk"
import { Catalog } from "@kancode/core/catalog"
import { CommandV2 } from "@kancode/core/command"
import { Credential } from "@kancode/core/credential"
import { AppNodeBuilder } from "@kancode/core/effect/app-node-builder"
import { LayerNodePlatform } from "@kancode/core/effect/app-node-platform"
import { LayerNode } from "@kancode/core/effect/layer-node"
import { EventV2 } from "@kancode/core/event"
import { FileSystem } from "@kancode/core/filesystem"
import { FSUtil } from "@kancode/core/fs-util"
import { Integration } from "@kancode/core/integration"
import { Location } from "@kancode/core/location"
import { Npm } from "@kancode/core/npm"
import { PluginV2 } from "@kancode/core/plugin"
import { Reference } from "@kancode/core/reference"
import { SkillV2 } from "@kancode/core/skill"
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
