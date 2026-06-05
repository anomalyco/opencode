import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { SystemContext } from "@opencode-ai/core/system-context"
import { Hash } from "@opencode-ai/core/util/hash"

const key = SystemContext.Key.make

describe("SystemContext", () => {
  test("loads one coherent sample and initializes a deterministic baseline", async () => {
    let loads = 0
    const context = SystemContext.struct({
      date: SystemContext.value({
        key: key("core/date"),
        load: Effect.sync(() => {
          loads++
          return { baseline: "Today's date is 2026-06-03.", update: "The current date is 2026-06-03." }
        }),
      }),
      location: SystemContext.value({
        key: key("core/location"),
        load: Effect.succeed({ baseline: "Working directory: /repo", update: "The working directory is /repo." }),
      }),
    })

    const initialized = SystemContext.initialize(await Effect.runPromise(SystemContext.load(context)))

    expect(loads).toBe(1)
    expect(initialized).toEqual({
      baseline: [
        { key: key("core/date"), text: "Today's date is 2026-06-03." },
        { key: key("core/location"), text: "Working directory: /repo" },
      ],
      checkpoint: {
        "core/date": Hash.sha256("The current date is 2026-06-03."),
        "core/location": Hash.sha256("The working directory is /repo."),
      },
    })
  })

  test("emits changed and newly registered components in declaration order", async () => {
    const context = SystemContext.struct({
      date: SystemContext.value({
        key: key("core/date"),
        load: Effect.succeed({ baseline: "Today's date is 2026-06-04.", update: "The current date is 2026-06-04." }),
      }),
      location: SystemContext.value({
        key: key("core/location"),
        load: Effect.succeed({ baseline: "Working directory: /repo", update: "The working directory is /repo." }),
      }),
      skills: SystemContext.value({
        key: key("core/skills"),
        load: Effect.succeed({ baseline: "Available skills: effect", update: "Available skills: effect" }),
      }),
    })

    const refreshed = SystemContext.refresh(await Effect.runPromise(SystemContext.load(context)), {
      "core/date": Hash.sha256("The current date is 2026-06-03."),
      "core/location": Hash.sha256("The working directory is /repo."),
    })

    expect(refreshed).toEqual({
      changes: [
        { key: key("core/date"), text: "The current date is 2026-06-04." },
        { key: key("core/skills"), text: "Available skills: effect" },
      ],
      checkpoint: {
        "core/date": Hash.sha256("The current date is 2026-06-04."),
        "core/location": Hash.sha256("The working directory is /repo."),
        "core/skills": Hash.sha256("Available skills: effect"),
      },
    })
    expect(SystemContext.render(refreshed.changes)).toBe("The current date is 2026-06-04.\n\nAvailable skills: effect")
  })

  test("omits unavailable initial context and admits it after its first successful load", async () => {
    let available = false
    const context = SystemContext.struct({
      remote: SystemContext.value({
        key: key("core/remote-instructions"),
        load: Effect.sync(() =>
          available
            ? { baseline: "Remote instructions: available", update: "Remote instructions are now available." }
            : SystemContext.unavailable,
        ),
      }),
    })

    const initialized = SystemContext.initialize(await Effect.runPromise(SystemContext.load(context)))
    available = true
    const refreshed = SystemContext.refresh(
      await Effect.runPromise(SystemContext.load(context)),
      initialized.checkpoint,
    )

    expect(initialized).toEqual({ baseline: [], checkpoint: {} })
    expect(refreshed.changes).toEqual([
      { key: key("core/remote-instructions"), text: "Remote instructions are now available." },
    ])
  })

  test("retains an existing checkpoint while context is unavailable", async () => {
    const previous = { "core/remote-instructions": Hash.sha256("Remote instructions: old") }
    const context = SystemContext.struct({
      remote: SystemContext.value({
        key: key("core/remote-instructions"),
        load: Effect.succeed(SystemContext.unavailable),
      }),
    })

    const refreshed = SystemContext.refresh(await Effect.runPromise(SystemContext.load(context)), previous)

    expect(refreshed).toEqual({ changes: [], checkpoint: previous })
  })

  test("drops checkpoints for removed components", async () => {
    const context = SystemContext.struct({
      date: SystemContext.value({
        key: key("core/date"),
        load: Effect.succeed({ baseline: "Today's date is 2026-06-03.", update: "The current date is 2026-06-03." }),
      }),
    })

    const refreshed = SystemContext.refresh(await Effect.runPromise(SystemContext.load(context)), {
      "core/date": Hash.sha256("The current date is 2026-06-03."),
      "plugin/removed": Hash.sha256("Removed plugin context"),
    })

    expect(refreshed).toEqual({
      changes: [],
      checkpoint: { "core/date": Hash.sha256("The current date is 2026-06-03.") },
    })
  })

  test("ignores inherited checkpoint properties", async () => {
    const context = SystemContext.struct({
      date: SystemContext.value({
        key: key("core/date"),
        load: Effect.succeed({ baseline: "Today's date is 2026-06-03.", update: "The current date is 2026-06-03." }),
      }),
    })
    const previous = Object.create({
      "core/date": Hash.sha256("The current date is 2026-06-03."),
    }) as SystemContext.Checkpoint

    const refreshed = SystemContext.refresh(await Effect.runPromise(SystemContext.load(context)), previous)

    expect(refreshed.changes).toEqual([{ key: key("core/date"), text: "The current date is 2026-06-03." }])
    expect(Object.hasOwn(refreshed.checkpoint, "core/date")).toBe(true)
  })

  test("preserves unexpected loader failures", async () => {
    const context = SystemContext.struct({
      broken: SystemContext.value({
        key: key("plugin/broken"),
        load: Effect.fail("broken loader"),
      }),
    })

    await expect(Effect.runPromise(SystemContext.load(context))).rejects.toBe("broken loader")
  })

  test("rejects duplicate component keys", () => {
    expect(() =>
      SystemContext.struct({
        one: SystemContext.value({ key: key("core/date"), load: Effect.succeed({ baseline: "one", update: "one" }) }),
        two: SystemContext.value({ key: key("core/date"), load: Effect.succeed({ baseline: "two", update: "two" }) }),
      }),
    ).toThrow(new SystemContext.DuplicateKeyError({ key: key("core/date") }))
  })

  test("rejects duplicate component keys at the interpreter boundary", async () => {
    const component = SystemContext.value({
      key: key("core/date"),
      load: Effect.succeed({ baseline: "date", update: "date" }),
    })
    const context: SystemContext.SystemContext = { components: [component, component] }

    await expect(Effect.runPromise(SystemContext.load(context))).rejects.toBeInstanceOf(SystemContext.DuplicateKeyError)
  })

  test("requires namespaced component keys", () => {
    const decode = Schema.decodeUnknownSync(SystemContext.Key)

    expect(decode("core/date")).toBe(key("core/date"))
    expect(() => decode("date")).toThrow()
    expect(() => decode("core/")).toThrow()
  })
})
