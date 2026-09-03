import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { ShellParse } from "../../src/shell/parse.js"
import { ShellScan } from "../../src/shell/scan.js"

const conditions = ["[[ -n <(scan_probe) ]]", "[[ -n >(scan_probe) ]]"]
const contexts = [
  (source: string) => source,
  (source: string) => `( ${source} )`,
  (source: string) => `{ ${source}; }`,
  (source: string) => `if ${source}; then printf visible; fi`,
  (source: string) => `check() { ${source}; }; check`,
  (source: string) => `printf '%s' "$( ${source}; printf visible)"`,
]

const functions = ["probe", "probe-name", "probe.name", "probe:name"].flatMap((name) =>
  [`${name}()`, `function ${name}`, `function ${name}()`].flatMap((head) =>
    [
      "{ scan_probe; }",
      "(scan_probe)",
      "if true; then scan_probe; fi",
      "[[ $(scan_probe) == ok ]]",
      "(( 1 + $(scan_probe) ))",
    ].map((body) => `${head} ${body}; ${name}`),
  ),
)

describe("legacy-accepted shell syntax regressions", () => {
  test.each(["() { scan_probe; }", "probe() { scan_probe; }; probe"])(
    "preserves deeply indented function definitions: %s",
    async (source) => {
      const command = `( ${" ".repeat(32_000)}${source} )`
      const legacy = await Effect.runPromise(ShellParse.scan(command, "zsh", "/workspace"))
      expect(await Effect.runPromise(ShellParse.scanPortable(command, "zsh", "/workspace"))).toEqual(legacy)
    },
  )

  test.each(conditions.flatMap((source) => contexts.map((context) => context(source))))(
    "retains conditional process substitutions and permission resources: %s",
    async (source) => {
      const legacy = await Effect.runPromise(ShellParse.scan(source, "bash", "/workspace"))
      expect(legacy.commands.some((command) => command.resource === "scan_probe")).toBe(true)
      expect(await Effect.runPromise(ShellParse.scanPortable(source, "bash", "/workspace"))).toEqual(legacy)
    },
  )

  for (const shell of ["bash", "zsh"]) {
    test.each(
      ["probe()", "probe \\\n()", "function \\\nprobe()", "function probe \\\n()"].flatMap((head) =>
        [" \\\n", " \\\n # ignored ) }\n", "# ignored \\\n"].flatMap((gap) =>
          contexts.map((context) => context(`${head}${gap}{ scan_probe; }; probe`)),
        ),
      ),
    )(`${shell} preserves line continuations at function boundaries: %s`, async (source) => {
      const legacy = await Effect.runPromise(ShellParse.scan(source, shell, "/workspace"))
      expect(legacy.commands.some((command) => command.resource === "scan_probe")).toBe(true)
      expect(await Effect.runPromise(ShellParse.scanPortable(source, shell, "/workspace"))).toEqual(legacy)
    })

    test.each(
      ["probe()", "function probe", "function probe()"].flatMap((head) =>
        [" # ignored ) }\n", "\n# ignored ) }\n\n", " # first\n# second\n"].flatMap((gap) =>
          contexts.map((context) => context(`${head}${gap}{ scan_probe; }; probe`)),
        ),
      ),
    )(`${shell} preserves comments between a function head and its body: %s`, async (source) => {
      const legacy = await Effect.runPromise(ShellParse.scan(source, shell, "/workspace"))
      expect(legacy.commands.some((command) => command.resource === "scan_probe")).toBe(true)
      expect(await Effect.runPromise(ShellParse.scanPortable(source, shell, "/workspace"))).toEqual(legacy)
    })

    test.each(functions)(
      `${shell} preserves function resources, saved prefixes, and directories: %s`,
      async (source) => {
        const legacy = await Effect.runPromise(ShellParse.scan(source, shell, "/workspace"))
        expect(legacy.commands.some((command) => command.resource === "scan_probe")).toBe(true)
        expect(await Effect.runPromise(ShellParse.scanPortable(source, shell, "/workspace"))).toEqual(legacy)
      },
    )

    const executable = Bun.which(shell)
    test
      .skipIf(!executable)
      .each([
        "probe-name() { scan_probe; }; probe-name",
        "function probe.name { scan_probe; }; probe.name",
        "probe:name() if true; then scan_probe; fi; probe:name",
        "probe()# ignored ) }\n{ scan_probe; }; probe",
        "probe \\\n() \\\n{ scan_probe; }; probe",
        "function \\\nprobe() # ignored \\\n{ scan_probe; }; probe",
        ...(shell === "bash" ? conditions : ["() { scan_probe; }"]),
      ])(`${shell} really executes the extracted command: %s`, (source) => {
      if (!executable) throw new Error(`${shell} is unavailable`)
      const execution = Bun.spawnSync(
        [
          executable,
          ...(shell === "bash" ? ["--noprofile", "--norc"] : ["-f"]),
          "-c",
          `scan_probe() { printf 'executed\\n' >&2; }; ${source}; wait`,
        ],
        { env: { PATH: "/usr/bin:/bin", LC_ALL: "C" } },
      )
      expect(execution.exitCode).toBe(0)
      expect(execution.stderr.toString()).toBe("executed\n")
      const result = ShellScan.scan(source)
      expect(result.kind).toBe("scanned")
      if (result.kind !== "scanned") throw new Error(result.reason)
      expect(result.commands.map((command) => command.words[0])).toContain("scan_probe")
    })
  }

  test.each([
    "() { scan_probe; }",
    "( () { scan_probe; } )",
    "{ () { scan_probe; }; }",
    "while() { scan_probe; break; }",
    "until() { scan_probe; break; }",
  ])("preserves Zsh anonymous functions and parenthesized loop permissions: %s", async (source) => {
    const legacy = await Effect.runPromise(ShellParse.scan(source, "zsh", "/workspace"))
    expect(legacy.commands.some((command) => command.resource === "scan_probe")).toBe(true)
    expect(await Effect.runPromise(ShellParse.scanPortable(source, "zsh", "/workspace"))).toEqual(legacy)
  })

  // Tree-sitter recovers these valid Zsh forms with synthetic commands or truncated outer resources.
  // Pin both results rather than treating recovery artifacts as executable shell syntax.
  test.each([
    {
      source: "if () { scan_probe; }; then printf visible; fi",
      legacy: ["scan_probe", "then printf visible", "fi"],
      portable: ["scan_probe", "printf visible"],
    },
    {
      source: "check() { () { scan_probe; }; }; check",
      legacy: ["scan_probe", "}", "check"],
      portable: ["scan_probe", "check"],
    },
    {
      source: "printf '%s' \"$( () { scan_probe; }; printf visible)\"",
      legacy: ["printf '%s'", "scan_probe", "printf visible"],
      portable: ["printf '%s' \"$( () { scan_probe; }; printf visible)\"", "scan_probe", "printf visible"],
    },
  ])("accepts anonymous-function compositions despite legacy recovery artifacts: $source", async (fixture) => {
    const legacy = await Effect.runPromise(ShellParse.scan(fixture.source, "zsh", "/workspace"))
    const portable = await Effect.runPromise(ShellParse.scanPortable(fixture.source, "zsh", "/workspace"))
    expect(legacy.commands.map((command) => command.resource)).toEqual([...fixture.legacy])
    expect(portable.commands.map((command) => command.resource)).toEqual([...fixture.portable])
  })

  test.each([
    "[[ -n '<(scan_ignored)' ]]",
    '[[ -n "<(scan_ignored)" ]]',
    "[[ -n '>(scan_ignored)' ]]",
    '[[ -n ">(scan_ignored)" ]]',
    "[[ -n $'<(scan_ignored)' ]]",
  ])("does not turn quoted process-substitution text into commands: %s", (source) => {
    expect(ShellScan.scan(source)).toEqual({ kind: "scanned", commands: [] })
  })
})
