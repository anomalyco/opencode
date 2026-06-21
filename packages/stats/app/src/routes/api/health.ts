import { AppConfig } from "@opencode-ai/stats-core/config"
import { Effect } from "effect"

export async function GET() {
  const { statsRuntime } = await import("../../stats-runtime")
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
