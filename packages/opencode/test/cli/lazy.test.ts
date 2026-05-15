import { describe, expect, mock, test } from "bun:test"
import yargs, { type Argv, type CommandModule } from "yargs"
import { lazy } from "../../src/cli/lazy"

// Minimal CommandModule stub with sensible defaults; tests override the parts
// they care about. Kept narrow on purpose — these tests cover the lazy()
// wrapper's behaviour, not yargs's option parsing.
function stubCommand(overrides: Partial<CommandModule<unknown, unknown>> = {}): CommandModule<unknown, unknown> {
  return {
    command: "stub",
    describe: "stub",
    builder: (y) => y,
    handler: () => {},
    ...overrides,
  }
}

describe("cli.lazy", () => {
  test("registers metadata synchronously without invoking the loader", () => {
    const load = mock(() => Promise.resolve(stubCommand()))
    const cmd = lazy(
      { command: "foo", describe: "manage foos", aliases: ["f"], deprecated: "use bar" },
      load,
    )

    expect(load).not.toHaveBeenCalled()
    expect(cmd.command).toBe("foo")
    expect(cmd.describe).toBe("manage foos")
    expect(cmd.aliases).toEqual(["f"])
    expect(cmd.deprecated).toBe("use bar")
  })

  test("loader runs at most once across repeated builder + handler invocations", async () => {
    const handler = mock(() => undefined)
    const load = mock(() => Promise.resolve(stubCommand({ handler })))
    const cmd = lazy({ command: "x", describe: "x" }, load)

    const y = yargs([])
    await (cmd.builder as (a: Argv) => unknown)(y)
    await (cmd.builder as (a: Argv) => unknown)(y)
    await (cmd.handler as (a: unknown) => unknown)({})

    expect(load).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  test("forwards function-form builders so option specs reach yargs", async () => {
    const inner = mock((y: Argv) => y.option("flag", { type: "boolean" }))
    const cmd = lazy(
      { command: "x", describe: "x" },
      () => Promise.resolve(stubCommand({ builder: inner as never })),
    )

    await (cmd.builder as (a: Argv) => Promise<Argv>)(yargs([]))
    expect(inner).toHaveBeenCalledTimes(1)
  })

  test("routes object-form builders through yargs.options()", async () => {
    const cmd = lazy(
      { command: "x", describe: "x" },
      () =>
        Promise.resolve(
          stubCommand({
            builder: { flag: { type: "boolean", describe: "..." } } as never,
          }),
        ),
    )

    const parsed = await ((await (cmd.builder as (a: Argv) => Promise<Argv>)(yargs([])))
      .parseAsync(["--flag"]) as Promise<Record<string, unknown>>)
    expect(parsed.flag).toBe(true)
  })

  test("returns yargs unchanged when the loaded module has no builder", async () => {
    const cmd = lazy(
      { command: "x", describe: "x" },
      () => Promise.resolve(stubCommand({ builder: undefined })),
    )

    const y = yargs([])
    const result = await (cmd.builder as (a: Argv) => Promise<Argv>)(y)
    expect(result).toBe(y)
  })

  test("forwards parsed args to the loaded handler and awaits it", async () => {
    let seen: unknown
    const handler = mock(async (args: unknown) => {
      seen = args
    })
    const cmd = lazy(
      { command: "x", describe: "x" },
      () => Promise.resolve(stubCommand({ handler })),
    )

    await (cmd.handler as (a: unknown) => Promise<void>)({ foo: "bar" })
    expect(seen).toEqual({ foo: "bar" })
  })

  test("wraps loader rejections with the command name and preserves the original error", async () => {
    const original = new Error("chunk missing")
    const cmd = lazy({ command: "broken", describe: "broken" }, () => Promise.reject(original))

    let caught: unknown
    try {
      await (cmd.builder as (a: Argv) => Promise<Argv>)(yargs([]))
    } catch (e) {
      caught = e
    }

    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toBe('Failed to lazy-load command "broken"')
    expect((caught as Error).cause).toBe(original)
  })

  test("uses the first entry when command is an array of names", async () => {
    const cmd = lazy(
      { command: ["primary", "alt"], describe: "..." },
      () => Promise.reject(new Error("nope")),
    )

    let caught: unknown
    try {
      await (cmd.handler as (a: unknown) => Promise<void>)({})
    } catch (e) {
      caught = e
    }

    expect((caught as Error).message).toBe('Failed to lazy-load command "primary"')
  })

  test("caches failed loads so a single error surfaces from every entrypoint", async () => {
    const load = mock(() => Promise.reject(new Error("boom")))
    const cmd = lazy({ command: "x", describe: "x" }, load)

    const errors: unknown[] = []
    for (const fn of [() => (cmd.builder as (a: Argv) => unknown)(yargs([])), () => (cmd.handler as (a: unknown) => unknown)({})]) {
      try {
        await fn()
      } catch (e) {
        errors.push(e)
      }
    }

    expect(load).toHaveBeenCalledTimes(1)
    expect(errors).toHaveLength(2)
    expect((errors[0] as Error).message).toBe('Failed to lazy-load command "x"')
    expect((errors[1] as Error).message).toBe('Failed to lazy-load command "x"')
  })
})
