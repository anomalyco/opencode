import { expect, spyOn } from "bun:test"
import { Effect } from "effect"
import { it } from "../../core/test/lib/effect"
import { Elevation } from "../src/services/elevation"
import { ServerProcess } from "../src/server-process"
import { Standalone } from "../src/services/standalone"

it.live(
  "explicit consent bypasses the elevation check",
  Effect.gen(function* () {
    yield* Elevation.check(true)
  }),
)

it.live(
  "the current process requires consent only when elevated",
  Effect.gen(function* () {
    const elevated = yield* Elevation.elevated()
    const result = yield* Elevation.check().pipe(Effect.result)
    expect(result._tag).toBe(elevated ? "Failure" : "Success")
    if (result._tag === "Failure") {
      expect(result.failure.message).toContain("--allow-elevated")
      expect(result.failure.message).toContain("non-administrator")
    }
  }),
)

// Only the OS identity boundary is stubbed; no server is spawned or given real root privileges.
if (process.platform !== "win32") {
  it.live(
    "effective root is rejected before any server mode or standalone can start",
    Effect.gen(function* () {
      const uid = spyOn(process, "geteuid").mockReturnValue(0)
      try {
        for (const mode of ["default", "service", "stdio"] as const) {
          const result = yield* ServerProcess.run({ mode, port: 0 }).pipe(Effect.result)
          expect(result._tag).toBe("Failure")
          if (result._tag === "Failure") expect(String(result.failure)).toContain("--allow-elevated")
        }
        const result = yield* Standalone.start().pipe(Effect.scoped, Effect.result)
        expect(result._tag).toBe("Failure")
        if (result._tag === "Failure") expect(String(result.failure)).toContain("--allow-elevated")
        yield* Elevation.check(true)
      } finally {
        uid.mockRestore()
      }
    }),
  )

  it.live(
    "an ordinary effective user needs no consent",
    Effect.gen(function* () {
      const uid = spyOn(process, "geteuid").mockReturnValue(1000)
      try {
        yield* Elevation.check()
      } finally {
        uid.mockRestore()
      }
    }),
  )
}
