import { EOL } from "os"
import { AgentV2 } from "@opencode-ai/core/agent"
import { PluginV2 } from "@opencode-ai/core/plugin"
import * as Effect from "effect/Effect"
import * as Command from "effect/unstable/cli/Command"
import { LocationServiceMap } from "@opencode-ai/core/location-layer"
import { AbsolutePath } from "@opencode-ai/core/schema"

export const AgentsCommand = Command.make("agents", {}, () =>
  Effect.gen(function* () {
    const plugin = yield* PluginV2.Service
    const agent = yield* AgentV2.Service
    // Upstream removed the global PluginBoot service in favor of per-plugin
    // PluginV2.wait(id). Wait for the agent-contributing plugins so AgentV2.all()
    // returns the full set (built-in "agent" + config-defined "config-agent").
    yield* plugin.wait(PluginV2.ID.make("agent"))
    yield* plugin.wait(PluginV2.ID.make("config-agent"))
    const agents = yield* agent.all()
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
