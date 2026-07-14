import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { expect } from "bun:test"
import { Effect } from "effect"
import { it } from "../../core/test/lib/effect"
import { Status } from "../src/service-status"

it.effect("moves from starting to ready", () =>
  Effect.gen(function* () {
    const status = yield* Status.make({ instanceID: "one", managed: false })
    expect(yield* status.current).toEqual({ type: "starting" })
    yield* status.ready
    expect(yield* status.current).toEqual({ type: "ready" })
  }),
)

it.effect("keeps a startup failure until shutdown", () =>
  Effect.gen(function* () {
    const status = yield* Status.make({ instanceID: "one", managed: true })
    yield* status.fail({ message: "Could not open the database.", action: "Check the database path." })
    yield* status.ready
    yield* status.fail({ message: "Different failure.", action: "Different action." })
    expect(yield* status.current).toEqual({
      type: "failed",
      message: "Could not open the database.",
      action: "Check the database path.",
    })
  }),
)

it.effect("stops only the addressed managed instance", () =>
  Effect.gen(function* () {
    const status = yield* Status.make({ instanceID: "one", managed: true })

    expect(yield* status.requestStop({ instanceID: "other", targetVersion: "next" })).toBe(false)
    expect(yield* status.current).toEqual({ type: "starting" })
    expect(yield* status.requestStop({ instanceID: "one", targetVersion: "next" })).toBe(true)
    expect(yield* status.requestStop({ instanceID: "one", targetVersion: InstallationVersion })).toBe(true)
    expect(yield* status.current).toEqual({ type: "stopping", targetVersion: "next" })
  }),
)

it.effect("preserves the original stopping target after shutdown begins", () =>
  Effect.gen(function* () {
    const status = yield* Status.make({ instanceID: "one", managed: true })

    yield* status.beginStopping("next")
    expect(yield* status.current).toEqual({ type: "stopping", targetVersion: "next" })
    expect(yield* status.requestStop({ instanceID: "one" })).toBe(true)
    expect(yield* status.current).toEqual({ type: "stopping", targetVersion: "next" })
  }),
)
