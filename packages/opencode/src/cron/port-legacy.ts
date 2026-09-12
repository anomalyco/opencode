import { Effect, Layer } from "effect"
import { CronDeliveryPort, CronDeliveryError } from "@opencode-ai/core/cron/port"
import { ModelV2 } from "@opencode-ai/core/model"
import { SessionPrompt } from "@/session/prompt"
import { Session } from "@/session/session"
import { SessionID } from "@/session/schema"
import { attachWith } from "@/effect/run-service"
import type { InstanceContext } from "@/project/instance-context"

export const CronDeliveryPortLive = Layer.effect(
  CronDeliveryPort,
  Effect.gen(function* () {
    const promptSvc = yield* SessionPrompt.Service
    const sessionSvc = yield* Session.Service

    return CronDeliveryPort.of({
      deliver: (sessionID, prompt, opts) => {
        const refs = (opts?.context ?? {}) as { instance?: InstanceContext; workspace?: string }
        const work = promptSvc
          .prompt({
            sessionID: SessionID.make(sessionID),
            parts: [{ type: "text", text: prompt }],
            agent: opts?.agent,
            model: opts?.model ? ModelV2.parse(opts.model) : undefined,
          })
          .pipe(Effect.asVoid)
        return attachWith(work, refs).pipe(Effect.mapError((e) => new CronDeliveryError({ message: String(e) })))
      },
      exists: (sessionID) =>
        sessionSvc.get(SessionID.make(sessionID)).pipe(
          Effect.as(true),
          Effect.orElseSucceed(() => false),
        ),
    })
  }),
)
