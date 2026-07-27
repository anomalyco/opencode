import { Effect, Layer } from "effect"
import { CronDeliveryPort, CronDeliveryError } from "@opencode-ai/core/cron/port"
import { SessionRunState } from "@/session/run-state"
import { SessionPrompt } from "@/session/prompt"
import { Session } from "@/session/session"

const parseModel = (raw?: string) => {
  if (!raw) return undefined
  const [providerID, modelID] = raw.split("/")
  if (!providerID || !modelID) return undefined
  return { providerID, modelID }
}

export const CronDeliveryPortLive = Layer.effect(
  CronDeliveryPort,
  Effect.gen(function* () {
    const runState = yield* SessionRunState.Service
    const promptSvc = yield* SessionPrompt.Service
    const sessionSvc = yield* Session.Service

    return CronDeliveryPort.of({
      isBusy: (sessionID) =>
        runState.assertNotBusy(sessionID).pipe(
          Effect.as(false),
          Effect.catchTag("SessionBusyError", () => Effect.succeed(true)),
        ),
      deliver: (sessionID, prompt, opts) =>
        promptSvc
          .prompt({
            sessionID,
            parts: [{ type: "text", text: prompt }],
            agent: opts?.agent,
            model: parseModel(opts?.model),
          })
          .pipe(
            Effect.asVoid,
            Effect.mapError((e) => new CronDeliveryError({ message: String(e) })),
          ),
      exists: (sessionID) =>
        sessionSvc.get(sessionID).pipe(
          Effect.as(true),
          Effect.orElseSucceed(() => false),
        ),
    })
  }),
)
