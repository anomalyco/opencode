import { EOL } from "os"
import { AgentV2 } from "@opencode-ai/core/agent"
import { PluginBoot } from "@opencode-ai/core/plugin/boot"
import * as Effect from "effect/Effect"
import * as Command from "effect/unstable/cli/Command"

export const AgentsCommand = Command.make("agents", {}, () =>
  Effect.gen(function* () {
    yield* PluginBoot.Service.use((service) => service.wait())
    const agents = yield* AgentV2.Service.use((service) => service.all())
    process.stdout.write(
      JSON.stringify(
        agents.sort((a, b) => a.id.localeCompare(b.id)),
        null,
        2,
      ) + EOL,
    )
  }),
).pipe(Command.withDescription("List all agents"))
