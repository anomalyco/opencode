import { AgentV2 } from "@pencode-ai/core/agent"
import { AISDK } from "@pencode-ai/core/aisdk"
import { Catalog } from "@pencode-ai/core/catalog"
import { CommandV2 } from "@pencode-ai/core/command"
import { Credential } from "@pencode-ai/core/credential"
import { AppNodeBuilder } from "@pencode-ai/core/effect/app-node-builder"
import { LayerNodePlatform } from "@pencode-ai/core/effect/app-node-platform"
import { LayerNode } from "@pencode-ai/core/effect/layer-node"
import { EventV2 } from "@pencode-ai/core/event"
import { FileSystem } from "@pencode-ai/core/filesystem"
import { FSUtil } from "@pencode-ai/core/fs-util"
import { Integration } from "@pencode-ai/core/integration"
import { Location } from "@pencode-ai/core/location"
import { Npm } from "@pencode-ai/core/npm"
import { PluginV2 } from "@pencode-ai/core/plugin"
import { Reference } from "@pencode-ai/core/reference"
import { SkillV2 } from "@pencode-ai/core/skill"
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
