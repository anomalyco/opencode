import { EOL } from "os"
import { Effect } from "effect"
import { Agent } from "@/agent/agent"
import { Instruction } from "@/session/instruction"
import { Plugin } from "@/plugin"
import { Provider } from "@/provider/provider"
import { SystemPrompt } from "@/session/system"
import { errorMessage } from "@/util/error"
import { effectCmd, fail } from "../../effect-cmd"

export const PromptCommand = effectCmd({
  command: "prompt",
  describe: "export resolved system prompt",
  builder: (yargs) =>
    yargs
      .option("agent", {
        type: "string",
        describe: "agent name to resolve the prompt for",
      })
      .option("model", {
        type: "string",
        describe: "model in provider/model format",
      }),
  handler: Effect.fn("Cli.debug.prompt")(function* (args) {
    const agents = yield* Agent.Service
    const provider = yield* Provider.Service
    const sys = yield* SystemPrompt.Service
    const instruction = yield* Instruction.Service
    const plugin = yield* Plugin.Service

    const agent = args.agent ? yield* agents.get(args.agent) : yield* agents.defaultInfo()
    const modelRef = yield* (args.model ? Effect.succeed(Provider.parseModel(args.model)) : provider.defaultModel()).pipe(
      Effect.catch((error) => fail(errorMessage(error))),
    )
    const model = yield* provider
      .getModel(modelRef.providerID, modelRef.modelID)
      .pipe(Effect.catch((error) => fail(errorMessage(error))))
    const [env, instructions, mcpInstructions, skills] = yield* Effect.all([
      sys.environment(model),
      instruction.system().pipe(Effect.orDie),
      sys.mcp(agent),
      sys.skills(agent),
    ])

    const system = [
      [
        ...(agent.prompt ? [agent.prompt] : SystemPrompt.provider(model)),
        ...env,
        ...instructions,
        ...(mcpInstructions ? [mcpInstructions] : []),
        ...(skills ? [skills] : []),
      ]
        .filter((item) => item)
        .join("\n"),
    ]

    const header = system[0]
    yield* plugin.trigger("experimental.chat.system.transform", { sessionID: "debug-prompt", model }, { system })
    if (system.length > 2 && system[0] === header) {
      const rest = system.slice(1)
      system.length = 0
      system.push(header, rest.join("\n"))
    }

    process.stdout.write(system.join("\n") + EOL)
  }),
})
