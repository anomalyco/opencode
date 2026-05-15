import { describe, expect, test } from "bun:test"
import yargs from "yargs"
import { TuiThreadSpec } from "../../../src/cli/cmd/tui/thread-spec"
import { TuiThreadCommand } from "../../../src/cli/cmd/tui/thread"

describe("tui thread spec", () => {
  test("defines the shared default command help surface", () => {
    const cli = TuiThreadSpec.builder(yargs([]))
    const defaults = cli.parseSync([])
    const aliases = cli.parseSync(["-m", "model", "-c", "-s", "session-id"])

    expect(TuiThreadSpec.command).toBe("$0 [project]")
    expect(TuiThreadSpec.describe).toBe("start opencode tui")
    expect(defaults.port).toBe(0)
    expect(defaults.hostname).toBe("127.0.0.1")
    expect(defaults.mdns).toBe(false)
    expect(defaults.mdnsDomain).toBe("opencode.local")
    expect(defaults.cors).toEqual([])
    expect(aliases.model).toBe("model")
    expect(aliases.continue).toBe(true)
    expect(aliases.session).toBe("session-id")
  })

  test("TuiThreadCommand inherits command, describe, and builder from the spec by reference", () => {
    // Reference identity guards against the drift the dedup refactor was
    // designed to prevent: if anyone copies the spec into `thread.ts` (or
    // wraps the builder), this fails before the duplicated definitions can
    // diverge from `src/index.ts`'s default-command registration.
    expect(TuiThreadCommand.command).toBe(TuiThreadSpec.command)
    expect(TuiThreadCommand.describe).toBe(TuiThreadSpec.describe)
    expect(TuiThreadCommand.builder).toBe(TuiThreadSpec.builder)
  })

  test("parses each declared option to its expected type", () => {
    // Register through `.command()` so the `[project]` positional binds the
    // same way it does in `src/index.ts`. Parsing against the bare builder
    // would skip positionals.
    let parsed: Record<string, unknown> | undefined
    yargs([])
      .command(TuiThreadSpec.command, TuiThreadSpec.describe, TuiThreadSpec.builder, (args) => {
        parsed = args
      })
      .strict()
      .parseSync([
        "my-project",
        "--port",
        "1234",
        "--hostname",
        "0.0.0.0",
        "--mdns",
        "--mdns-domain",
        "custom.local",
        "--cors",
        "example.com",
        "--model",
        "anthropic/claude",
        "--continue",
        "--session",
        "abc",
        "--fork",
        "--prompt",
        "hi",
        "--agent",
        "default",
      ])

    if (!parsed) throw new Error("handler did not run")
    expect(parsed.project).toBe("my-project")
    expect(parsed.port).toBe(1234)
    expect(parsed.hostname).toBe("0.0.0.0")
    expect(parsed.mdns).toBe(true)
    expect(parsed.mdnsDomain).toBe("custom.local")
    expect(parsed.cors).toEqual(["example.com"])
    expect(parsed.model).toBe("anthropic/claude")
    expect(parsed.continue).toBe(true)
    expect(parsed.session).toBe("abc")
    expect(parsed.fork).toBe(true)
    expect(parsed.prompt).toBe("hi")
    expect(parsed.agent).toBe("default")
  })
})
