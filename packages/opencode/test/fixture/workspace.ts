import { FetchHttpClient } from "effect/unstable/http"
import { Layer } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Auth } from "../../src/auth"
import { Workspace } from "../../src/control-plane/workspace"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { InstanceStore } from "../../src/project/instance-store"
import { Project } from "../../src/project/project"
import { Vcs } from "../../src/project/vcs"
import { Session } from "../../src/session/session"
import { SessionPrompt } from "../../src/session/prompt"
import { EventV2Bridge } from "../../src/event-v2-bridge"

export const workspaceLayerWithRuntimeFlags = (overrides: Partial<RuntimeFlags.Info>) =>
  Workspace.layer.pipe(
    Layer.provide(Auth.defaultLayer),
    Layer.provide(Session.defaultLayer),
    Layer.provide(SessionPrompt.defaultLayer),
    Layer.provide(Project.defaultLayer),
    Layer.provide(Vcs.defaultLayer),
    Layer.provide(Database.defaultLayer),
    Layer.provide(EventV2Bridge.defaultLayer),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(FSUtil.defaultLayer),
    Layer.provide(RuntimeFlags.layer(overrides)),
    Layer.provide(LayerNode.compile(InstanceStore.node, [[InstanceStore.bootstrapNode, InstanceBootstrap.node]])),
  )
