import { EOL } from "os"
import { AgentV2 } from "@opencode-ai/core/agent"
import { PluginBoot } from "@opencode-ai/core/plugin/boot"
import * as Effect from "effect/Effect"
import * as Command from "effect/unstable/cli/Command"
import { LocationServiceMap } from "@opencode-ai/core/location-layer"
import { AbsolutePath } from "@opencode-ai/core/schema"

export const AgentsCommand = Command.make("agents", {}, () =>
  Effect.gen(function* () {
    const svc = {
      plugin: yield* PluginBoot.Service,
      agent: yield* AgentV2.Service,
    }
    yield* svc.plugin.wait()
    const agents = yield* svc.agent.all()
    process.stdout.write(
      JSON.stringify(
        agents.sort((a, b) => a.id.localeCompare(b.id)),
        null,
        2,
      ) + EOL,
    )
  }).pipe(
    Effect.provide(
      LocationServiceMap.get({
        directory: AbsolutePath.make(process.cwd()),
      }),
    ),
  ),
).pipe(Command.withDescription("List all agents"))
