import { EOL } from "os"
import { AgentV2 } from "@opencode-ai/core/agent"
import { LocationServiceMap } from "@opencode-ai/core/location-layer"
import { PluginBoot } from "@opencode-ai/core/plugin/boot"
import { AbsolutePath } from "@opencode-ai/core/schema"
import * as Effect from "effect/Effect"
import { Api } from "../../api"
import { CliBuilder } from "../../cli-builder"

export default CliBuilder.handler(
  Api.commands.debug.commands.agents,
  Effect.fn("cli.debug.agents")(
    function* () {
      const svc = {
        plugin: yield* PluginBoot.Service,
        agent: yield* AgentV2.Service,
      }
      yield* svc.plugin.wait()
      process.stdout.write(
        JSON.stringify(
          (yield* svc.agent.all()).sort((a, b) => a.id.localeCompare(b.id)),
          null,
          2,
        ) + EOL,
      )
    },
    Effect.provide(LocationServiceMap.get({ directory: AbsolutePath.make(process.cwd()) })),
    Effect.provide(LocationServiceMap.layer),
  ),
)
