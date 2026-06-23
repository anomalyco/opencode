import { Credential } from "@opencode-ai/core/credential"
import { EventV2 } from "@opencode-ai/core/event"
import { FileSystem } from "@opencode-ai/core/filesystem"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { Npm } from "@opencode-ai/core/npm"
import { PluginV2 } from "@opencode-ai/core/plugin"
import { RepositoryCache } from "@opencode-ai/core/repository-cache"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { SkillDiscovery } from "@opencode-ai/core/skill/discovery"
import { Effect, Layer } from "effect"
import { tempLocationLayer } from "../fixture/location"

export const PluginTestLayer = Layer.mergeAll(FileSystem.locationLayer, PluginV2.locationLayer).pipe(
  Layer.provideMerge(
    Layer.mergeAll(
      Credential.defaultLayer,
      EventV2.defaultLayer,
      FSUtil.defaultLayer,
      Global.defaultLayer,
      Layer.succeed(
        Npm.Service,
        Npm.Service.of({
          add: () => Effect.succeed({ directory: "", entrypoint: undefined }),
          install: () => Effect.void,
          which: () => Effect.succeed(undefined),
        }),
      ),
      RepositoryCache.defaultLayer,
      SkillDiscovery.defaultLayer,
      Ripgrep.defaultLayer,
      tempLocationLayer,
    ),
  ),
)
