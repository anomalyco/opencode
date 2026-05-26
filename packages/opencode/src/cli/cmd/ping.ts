import { EOL } from "os"
import { generateText, type ModelMessage } from "ai"
import { Effect } from "effect"
import { Agent } from "@/agent/agent"
import { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import { SessionID } from "@/session/schema"
import { effectCmd, fail } from "../effect-cmd"
import { ModelID, ProviderID } from "@/provider/schema"
import { InstanceState } from "@/effect/instance-state"
import { RuntimeFlags } from "@/effect/runtime-flags"

function pick(value: string | undefined) {
  if (!value) return
  const [providerID, ...rest] = value.split("/")
  return {
    providerID: ProviderID.make(providerID),
    modelID: ModelID.make(rest.join("/")),
  }
}

export const PingCommand = effectCmd({
  command: "ping",
  describe: "test the configured AI provider with a single request",
  builder: (yargs) =>
    yargs
      .option("model", {
        type: "string",
        alias: ["m"],
        describe: "model to test in the format of provider/model",
      })
      .option("agent", {
        type: "string",
        describe: "agent whose model and options should be used",
      })
      .option("variant", {
        type: "string",
        describe: "model variant to test",
      })
      .option("message", {
        type: "string",
        default: "Reply with exactly: pong",
        describe: "message to send",
      }),
  handler: Effect.fn("Cli.ping")(function* (args) {
    const agentSvc = yield* Agent.Service
    const provider = yield* Provider.Service
    const flags = yield* RuntimeFlags.Service
    const agent = args.agent ? yield* agentSvc.get(args.agent) : yield* agentSvc.defaultInfo()

    if (!agent) {
      return yield* fail(`Agent not found: ${args.agent}`)
    }

    const input = pick(args.model) ?? agent.model ?? (yield* provider.defaultModel())
    const model = yield* provider.getModel(input.providerID, input.modelID)
    const language = yield* provider.getLanguage(model)
    const sessionID = SessionID.descending()
    const variant =
      args.variant ??
      (!args.model && agent.model && agent.variant && model.variants?.[agent.variant] ? agent.variant : undefined)
    const message = args.message || "Reply with exactly: pong"
    const options = {
      ...ProviderTransform.options({
        model,
        sessionID,
        providerOptions: (yield* provider.getProvider(model.providerID)).options,
      }),
      ...model.options,
      ...agent.options,
      ...(variant && model.variants ? (model.variants[variant] ?? {}) : {}),
    }
    const messages: ModelMessage[] = [{ role: "user", content: message }]
    const projectID = model.providerID.startsWith("opencode") ? (yield* InstanceState.context).project.id : undefined
    const start = performance.now()
    const result = yield* Effect.promise(() =>
      generateText({
        model: language,
        messages: ProviderTransform.message(messages, model, options),
        temperature: model.capabilities.temperature
          ? (agent.temperature ?? ProviderTransform.temperature(model))
          : undefined,
        topP: agent.topP ?? ProviderTransform.topP(model),
        topK: ProviderTransform.topK(model),
        maxOutputTokens: Math.min(32, ProviderTransform.maxOutputTokens(model)),
        providerOptions: ProviderTransform.providerOptions(model, options),
        headers: {
          ...model.headers,
          ...(model.providerID.startsWith("opencode")
            ? {
                ...(projectID ? { "x-opencode-project": projectID } : {}),
                "x-opencode-session": sessionID,
                "x-opencode-request": "ping",
                "x-opencode-client": flags.client,
              }
            : {
                "x-session-affinity": sessionID,
              }),
          "User-Agent": "opencode",
        },
        maxRetries: 0,
      }),
    )

    process.stdout.write(`pong ${model.providerID}/${model.id} ${Math.round(performance.now() - start)}ms${EOL}`)
    if (result.text.trim()) process.stdout.write(result.text.trim() + EOL)
    if (result.usage) process.stdout.write(JSON.stringify(result.usage) + EOL)
  }),
})
