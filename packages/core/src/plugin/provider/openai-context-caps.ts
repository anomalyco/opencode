import { define } from "@opencode/plugin/effect/plugin"
import { Effect, Stream } from "effect"
import { Bus } from "../../bus.js"
import { Credential } from "../../credential.js"
import { Integration } from "../../integration.js"
import { Provider } from "../../provider.js"
import type { PluginInternal } from "../internal.js"

const integrationID = Integration.ID.make("openai")
const methodIDs = new Set(["chatgpt-browser", "chatgpt-headless", "chatgpt-token-sharing"])

// The backend accepts each model's full input window, but larger requests use more of the ChatGPT plan. OpenAI's
// default windows for ChatGPT plans are 272k, and 500k for gpt-6.1-sol; later models are assumed to keep 500k.
const legacyInput = 272_000
const currentInput = 500_000

export const OpenAIContextCapsPlugin = define({
  id: "opencode.provider.openai-context-caps",
  effect: Effect.fn(function* (ctx) {
    const bus = yield* Bus.Service
    let signedIn = false

    const load = Effect.fn("OpenAIContextCapsPlugin.load")(function* () {
      const connection = yield* ctx.integration.connection.active(integrationID)
      const credential = connection
        ? yield* ctx.integration.connection.resolve(connection).pipe(Effect.orElseSucceed(() => undefined))
        : undefined
      signedIn = credential?.type === "oauth" && methodIDs.has(credential.methodID)
    })

    yield* load()
    yield* ctx.model.transform((models) => {
      if (!signedIn) return
      for (const model of models.list(Provider.ID.openai)) {
        models.update(model.providerID, model.id, (draft) => {
          const input = cap(draft.modelID ?? draft.id)
          if ((draft.limit.input || draft.limit.context) <= input) return
          draft.limit = { ...draft.limit, input, context: input + draft.limit.output }
        })
      }
    })
    yield* bus.subscribe(Credential.Event.Switched).pipe(
      Stream.filter((event) => event.data.integrationID === integrationID),
      Stream.runForEach(() => load().pipe(Effect.andThen(ctx.provider.reload()))),
      Effect.forkScoped({ startImmediately: true }),
    )
  }),
} satisfies PluginInternal.InternalPlugin)

function cap(apiID: string) {
  const match = apiID.match(/^gpt-(\d+)(?:\.(\d+))?/)
  if (!match) return currentInput
  const major = Number(match[1])
  const minor = Number(match[2] ?? 0)
  return major > 6 || (major === 6 && minor >= 1) ? currentInput : legacyInput
}
