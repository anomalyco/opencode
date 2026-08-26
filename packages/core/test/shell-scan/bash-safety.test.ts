import { describe, expect, test } from "bun:test"
import { ShellScan } from "../../src/shell/scan.js"

const executions = [
  'printf safe; "scan_probe"',
  "printf safe; 'scan_probe'",
  "printf safe; $(printf scan_probe)",
  "X=${unset:-a b} scan_probe",
  "X=value # comment\nscan_probe",
  'printf "%s" `\\$(scan_probe)`',
  'printf %s `printf \\\\"; scan_probe; printf \\\\"`',
  "if true; then X=x scan_probe; fi",
  "if true; then >/dev/null X=x scan_probe; fi",
  "printf safe; { scan_probe; }",
  "if true; then { scan_probe; }; fi",
  "s{can_probe,can_probe}",
  'printf safe; # comment\n"scan_probe"',
  "printf safe; \\\n'scan_probe'",
] as const

describe("Bash execution safety", () => {
  for (const shell of ["bash", "zsh"]) {
    const executable = Bun.which(shell)
    test.skipIf(!executable).each([...executions])(`${shell} executions are visible or opaque: %s`, (source) => {
      const execution = Bun.spawnSync(
        [
          executable!,
          ...(shell === "bash" ? ["--noprofile", "--norc"] : ["-f"]),
          "-c",
          `scan_probe() { printf 'executed\\n' >&2; }; ${source}`,
        ],
        { env: { PATH: "/usr/bin:/bin", LC_ALL: "C" } },
      )
      expect(execution.stderr.toString()).toContain("executed\n")
      const result = ShellScan.scan(source)
      if (result.kind === "opaque") return
      expect(result.commands.map((command) => command.words[0])).toContain("scan_probe")
    })
  }

  test.each([
    "printf safe; { scan_probe; }",
    "if true; then { scan_probe; }; fi",
    "{scan_probe,printf}",
    "s{can_probe,can_probe}",
    "X=${unset:-a b} scan_probe",
    'echo "$[array[index]]"',
    "(( value ))",
    "echo ${array[index]}",
    'echo "${value@P}"',
    "echo $'unsupported\\'quote'",
    "printf ok && # comment",
    '"if" true; then printf safe; fi',
    "X=x if true; then printf safe; fi",
    "(printf ok) &&",
    "{ printf ok; } ||",
    "(printf ok) |",
    "(printf ok) |&",
  ])("does not claim unsupported command positions are scanned: %s", (source) => {
    expect(ShellScan.scan(source).kind).toBe("opaque")
  })

  test.each([" ", "\t"])("recognizes shell whitespace %j", (space) => {
    expect(ShellScan.scan(`printf${space}ok`)).toEqual({
      kind: "scanned",
      commands: [{ resource: `printf${space}ok`, words: ["printf", "ok"] }],
    })
  })

  test.each(["\r", "\v", "\f", "\u00a0", "\ufeff"])("does not normalize non-shell whitespace %j", (space) => {
    expect(ShellScan.scan(`${space}printf ok`).kind).toBe("opaque")
    expect(ShellScan.scan(`printf${space}ok`).kind).toBe("opaque")
  })

  test.each(["'123'", '"123"', "1\\23"])("does not consume quoted command names as fd prefixes: %s", (head) => {
    expect(ShellScan.scan(`${head}>/dev/null argument`)).toEqual({
      kind: "scanned",
      commands: [{ resource: `${head}>/dev/null argument`, words: ["123", "argument"] }],
    })
  })

  test.each([
    "X=x > output",
    "X=x 2> output",
    "X=x < input",
    "X=x >$(printf output)",
    "'' > output",
    "''",
    "{ printf ok; } > output",
    "{ printf ok; } 2> output",
    "{ printf ok; } &> output",
    "{ printf ok; } >$(printf output)",
    "(printf ok) > output",
    "> output (printf ok)",
    "{ printf ok; }; X=x > output",
  ])("does not discard redirection effects or empty command names: %s", (source) => {
    expect(ShellScan.scan(source).kind).toBe("opaque")
  })

  test("retains explicit colon commands and their redirects after a group", () => {
    expect(ShellScan.scan("(printf ok); : > output")).toEqual({
      kind: "scanned",
      commands: [
        { resource: "printf ok", words: ["printf", "ok"] },
        { resource: ": > output", words: [":"] },
      ],
    })
  })

  test.each([
    "(printf safe # ) ignored\nscan_probe)",
    "{ printf safe; # } ignored\nscan_probe; }",
    'echo "$(printf "\'"; scan_probe)"',
    'echo "$(printf "%s" "$(printf ")")"; scan_probe)"',
  ])("does not lose commands through delimiter or quote confusion: %s", (source) => {
    const result = ShellScan.scan(source)
    if (result.kind === "opaque") return
    expect(result.commands.map((command) => command.words[0])).toContain("scan_probe")
  })
})

describe("Bash real-shell differential grammar", () => {
  const probes = ["scan_first", "scan_second", "scan_third"]
  const words = [
    "scan_first",
    "'scan_first'",
    's"can_"first',
    "scan_first 'literal; $(not_a_command)'",
    "X=value scan_first",
    'X="$(scan_second)" scan_first',
    'scan_first "$(scan_second)"',
    "scan_first `scan_second`",
    'scan_first "$(printf "\'"; scan_second)"',
  ]
  const contexts = [
    (source: string) => source,
    (source: string) => `${source}; scan_third`,
    (source: string) => `${source} && scan_third`,
    (source: string) => `${source} | scan_third`,
    (source: string) => `(${source})`,
    (source: string) => `{ ${source}; }`,
    (source: string) => `scan_third "$(${source})"`,
    (source: string) => `if true; then ${source}; fi`,
    (source: string) => `Y="$(${source})" scan_third`,
    (source: string) => `${source} >/dev/null`,
  ]

  for (const shell of ["bash", "zsh", Bun.which("dash") ? "dash" : "sh"]) {
    const executable = Bun.which(shell)
    const sources = (
      shell === "bash" || shell === "zsh"
        ? [...words, "scan_first <(scan_second)", 'values=(value "$(scan_second)"); scan_first']
        : words
    ).flatMap((source) => contexts.map((context) => context(source)))

    test.skipIf(!executable).each(sources)(`${shell}: %s`, (source) => {
      const execution = Bun.spawnSync(
        [
          executable!,
          ...(shell === "bash" ? ["--noprofile", "--norc"] : shell === "zsh" ? ["-f"] : []),
          "-c",
          probes.map((name) => `${name}() { printf '${name}\\n' >&2; }; `).join("") + source,
        ],
        { env: { PATH: "/usr/bin:/bin", LC_ALL: "C" } },
      )
      expect(execution.exitCode).toBe(0)
      const observed = execution.stderr.toString().trim().split("\n")
      expect(observed.length).toBeGreaterThan(0)
      expect(observed.every((name) => probes.includes(name))).toBe(true)
      const result = ShellScan.scan(source)
      if (result.kind === "opaque") return
      for (const name of observed) expect(result.commands.map((command) => command.words[0])).toContain(name)
    })
  }
})
