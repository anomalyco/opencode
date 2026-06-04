import { expect } from "bun:test"
import { Effect } from "effect"
import { UiSettings } from "../../src/ui/settings"
import { testEffect } from "../lib/effect"

const it = testEffect(UiSettings.defaultLayer)

it.effect("preserves queue followup through update and readback", () =>
  Effect.gen(function* () {
    const settings = yield* UiSettings.Service
    const next = yield* settings.updateApp({
      ...UiSettings.defaultAppSettings,
      general: {
        ...UiSettings.defaultAppSettings.general,
        followup: "queue",
      },
    })

    expect(next.settings.general.followup).toBe("queue")

    const readback = yield* settings.get()
    expect(readback.settings.general.followup).toBe("queue")
  }),
)
