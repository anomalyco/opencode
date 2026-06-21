import { AppConfig } from "@opencode-ai/stats-core/config"
import { Effect } from "effect"
import { statsRuntime } from "../../stats-runtime"

export async function GET() {
  return Response.json(
    await statsRuntime.runPromise(
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
