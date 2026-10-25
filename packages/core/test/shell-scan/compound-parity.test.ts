import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { ShellParse } from "../../src/shell/parse.js"
import { ShellScan } from "../../src/shell/scan.js"

const contexts = [
  (source: string) => source,
  (source: string) => `( ${source} )`,
  (source: string) => `{ ${source}; }`,
  (source: string) => `if true; then ${source}; fi`,
  (source: string) => `outer() { ${source}; }; outer`,
]

const bodies = [
  "for value in one two; do scan_probe; done",
  "while true; do scan_probe; break; done",
  "until false; do scan_probe; break; done",
  "case value in value) scan_probe;; *) scan_other;; esac",
]

describe("compound function acceptance", () => {
  for (const shell of ["bash", "zsh"]) {
    for (const head of ["probe()", "function probe", "function probe()", "probe-name()"])
      for (const body of bodies)
        for (const context of contexts) {
          const name = head.includes("probe-name") ? "probe-name" : "probe"
          const source = context(`${head} ${body}; ${name}`)
          test(`${shell}: ${source}`, async () => {
            // Braces preserve the function's behavior, but avoid Tree-sitter's recovery artifacts.
            const legacy = await Effect.runPromise(
              ShellParse.scan(context(`${head} { ${body}; }; ${name}`), shell, "/workspace"),
            )
            expect(await Effect.runPromise(ShellParse.scanPortable(source, shell, "/workspace"))).toEqual(legacy)
          })
        }
  }

  test.each(bodies)("keeps compound function bodies inside command substitutions: %s", (body) => {
    const source = `printf '%s' "$( probe() ${body}; probe )"`
    const result = ShellScan.scan(source)
    expect(result.kind).toBe("scanned")
    if (result.kind !== "scanned") throw new Error(result.reason)
    expect(result.commands[0]?.resource).toBe(source)
    expect(result.commands.map((command) => command.words[0])).toContain("scan_probe")
    expect(result.commands.at(-1)?.words).toEqual(["probe"])
  })
})

const values = [
  "one two",
  "'two words' one",
  "'cd' '/outside'",
  "'do' 'done'",
  "'(literal)' '$(scan_ignored)'",
  "one\\\ntwo",
  "$(printf one)",
  '"$(printf one)"',
  "<(printf one)",
  "",
]
const loops = values.flatMap((value) =>
  [
    `for value (${value}) scan_probe "$value"`,
    `for value (${value}) { scan_probe "$value"; }`,
    ...(value
      ? [
          `for value (${value}) do scan_probe "$value"; done`,
          `for value (${value}); do scan_probe "$value"; done`,
          `for value (${value})\ndo scan_probe "$value"; done`,
          `for value (${value}) # ignored\ndo scan_probe "$value"; done`,
          `for value (${value}) \\\ndo scan_probe "$value"; done`,
        ]
      : []),
  ].map((source) => ({ source, equivalent: `for value in ${value}; do scan_probe "$value"; done` })),
)

describe("Zsh parenthesized loop acceptance", () => {
  for (const fixture of loops)
    for (const context of contexts) {
      const source = context(fixture.source)
      test(source, async () => {
        const legacy = await Effect.runPromise(ShellParse.scan(context(fixture.equivalent), "zsh", "/workspace"))
        expect(await Effect.runPromise(ShellParse.scanPortable(source, "zsh", "/workspace"))).toEqual(legacy)
      })
    }

  test.each([
    "for x (one two) for y (a b) scan_probe",
    "for x (one two) scan_probe && scan_other",
    "for x (one two) scan_probe | scan_other",
    "printf '%s' \"$(for x (one two) scan_probe)\"",
    "for x (one two) { for y (a b); do scan_probe; done; }",
    "for x (one two) [[ $(scan_probe) == ok ]]",
    "for x (one two) (( 1 + $(scan_probe) ))",
  ])("retains commands in nested shorthand loops: %s", (source) => {
    const result = ShellScan.scan(source)
    expect(result.kind).toBe("scanned")
    if (result.kind !== "scanned") throw new Error(result.reason)
    expect(result.commands.map((command) => command.words[0])).toContain("scan_probe")
    if (source.includes("scan_other"))
      expect(result.commands.map((command) => command.words[0])).toContain("scan_other")
  })
})

describe("real-shell compound syntax", () => {
  for (const shell of ["bash", "zsh"]) {
    const executable = Bun.which(shell)
    test
      .skipIf(!executable)
      .each([
        ...bodies.map((body) => `probe() ${body}; probe`),
        ...bodies.map((body) => `printf '%s' "$(probe() ${body}; probe)"`),
        ...(shell === "zsh" ? loops.map((fixture) => fixture.source) : []),
      ])(`${shell}: %s`, (source) => {
      if (!executable) throw new Error(`${shell} is unavailable`)
      const execution = Bun.spawnSync(
        [
          executable,
          ...(shell === "bash" ? ["--noprofile", "--norc"] : ["-f"]),
          "-c",
          `scan_probe() { printf 'executed\\n' >&2; }; ${source}; wait`,
        ],
        { env: { PATH: "/usr/bin:/bin", LC_ALL: "C" }, timeout: 2_000 },
      )
      expect(execution.exitCode).toBe(0)
      expect(execution.stderr.toString()).toEqual(
        source.includes("value ()") ? "" : expect.stringContaining("executed\n"),
      )
      expect(ShellScan.scan(source).kind).toBe("scanned")
    })
  }
})
