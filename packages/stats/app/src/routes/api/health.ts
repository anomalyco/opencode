import { AppConfig } from "@daemon-protocol/stats-core/config"
import { runtime } from "@daemon-protocol/stats-core/runtime"
import { Effect } from "effect"

export async function GET() {
  return Response.json(
    await runtime.runPromise(
      Effect.gen(function* () {
        const config = yield* AppConfig
        return {
          ok: true,
          app: "stats",
          stage: config.stage,
          publicUrl: config.publicUrl,
        }
      }),
    ),
  )
}
