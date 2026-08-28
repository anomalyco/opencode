import { describe, expect, test } from "bun:test"
import { ShellScan } from "../../src/shell/scan.js"

const executions = [
  ['printf safe; "scan_probe"', "scan_probe"],
  ["printf safe; 'scan_probe'", "scan_probe"],
  ["printf safe; $(printf scan_probe)", "$(printf scan_probe)"],
  ["X=${unset:-a b} scan_probe", "scan_probe"],
  ["X=value # comment\nscan_probe", "scan_probe"],
  ['printf "%s" `\\$(scan_probe)`', "scan_probe"],
  ['printf %s `printf \\\\"; scan_probe; printf \\\\"`', "scan_probe"],
  ["if true; then X=x scan_probe; fi", "scan_probe"],
  ["if true; then >/dev/null X=x scan_probe; fi", "scan_probe"],
  ["printf safe; { scan_probe; }", "scan_probe"],
  ["if true; then { scan_probe; }; fi", "scan_probe"],
  ["s{can_probe,can_probe}", "s{can_probe,can_probe}"],
  ['printf safe; # comment\n"scan_probe"', "scan_probe"],
  ["printf safe; \\\n'scan_probe'", "scan_probe"],
] as const

describe("Bash execution safety", () => {
  for (const shell of ["bash", "zsh"]) {
    const executable = Bun.which(shell)
    test.skipIf(!executable).each([...executions])(`${shell} command syntax is visible: %s`, (source, head) => {
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
      expect(result.kind).toBe("scanned")
      if (result.kind === "opaque") throw new Error(result.reason)
      expect(result.commands.map((command) => command.words[0])).toContain(head)
    })
  }

  test.each([
    "printf ok && # comment",
    '"if" true; then printf safe; fi',
    "X=x if true; then printf safe; fi",
    "(printf ok) &&",
    "{ printf ok; } ||",
    "(printf ok) |",
    "(printf ok) |&",
  ])("rejects malformed command positions: %s", (source) => {
    expect(ShellScan.scan(source).kind).toBe("opaque")
  })

  test.each([" ", "\t"])("recognizes shell whitespace %j", (space) => {
    expect(ShellScan.scan(`printf${space}ok`)).toMatchObject({
      kind: "scanned",
      commands: [{ resource: `printf${space}ok`, words: ["printf", "ok"] }],
    })
  })

  test.each(["\r", "\v", "\f", "\u00a0", "\ufeff"])("does not normalize non-shell whitespace %j", (space) => {
    expect(ShellScan.scan(`${space}printf ok`).kind).toBe("opaque")
    expect(ShellScan.scan(`printf${space}ok`).kind).toBe("opaque")
  })

  test.each(["'123'", '"123"', "1\\23"])("does not consume quoted command names as fd prefixes: %s", (head) => {
    expect(ShellScan.scan(`${head}>/dev/null argument`)).toMatchObject({
      kind: "scanned",
      commands: [{ resource: `${head}>/dev/null argument`, words: ["123", "argument"] }],
    })
  })

  test.each([
    "'' > output",
    "''",
    "> output (printf ok)",
    "(printf ok) >output pwd",
    "{ printf ok; } >output X=x",
    "(printf ok) &>output pwd",
  ])("keeps unsupported group positions and empty command names opaque: %s", (source) => {
    expect(ShellScan.scan(source).kind).toBe("opaque")
  })

  test.each(["X=value > /dev/null", "X=x 2> output", "X=x < input", "> /dev/null", "2>> output", ">output 2>&1"])(
    "scans redirects without inventing an executable command: %s",
    (source) => {
      expect(ShellScan.scan(source)).toEqual({ kind: "scanned", commands: [] })
    },
  )

  test.each([">", "X=x >", "X=x > # comment\nprintf ok", ">; printf ok", "(printf ok) >", "{ printf ok; } >"])(
    "still requires redirect targets: %s",
    (source) => {
      expect(ShellScan.scan(source)).toEqual({ kind: "opaque", reason: "invalid-redirect" })
    },
  )

  test.each([
    "{ printf ok; } > output",
    "{ printf ok; } 2> output",
    "{ printf ok; } &> output",
    "(printf ok) > output",
    "{ printf ok; }; X=x > output",
  ])("scans leading groups and their redirects without synthetic commands: %s", (source) => {
    expect(ShellScan.scan(source)).toEqual({
      kind: "scanned",
      commands: [{ resource: "printf ok", words: ["printf", "ok"], rawWords: ["printf", "ok"] }],
    })
  })

  test.each(["X=x >$(printf output)", ">$(printf output)", "{ :; } >$(printf output)", "(:) >$(printf output)"])(
    "retains explicit substitutions in otherwise commandless redirects: %s",
    (source) => {
      const result = ShellScan.scan(source)
      expect(result.kind).toBe("scanned")
      if (result.kind === "opaque") return
      expect(result.commands.map((command) => command.words[0])).toEqual(
        source.includes(":") ? [":", "printf"] : ["printf"],
      )
      expect(result.commands.at(-1)).toEqual({
        resource: "printf output",
        words: ["printf", "output"],
        rawWords: ["printf", "output"],
      })
    },
  )

  test("scans a list following a group redirect suffix", () => {
    expect(ShellScan.scan("(printf ok) >output && pwd")).toEqual({
      kind: "scanned",
      commands: [
        { resource: "printf ok", words: ["printf", "ok"], rawWords: ["printf", "ok"] },
        { resource: "pwd", words: ["pwd"], rawWords: ["pwd"] },
      ],
    })
  })

  test("retains explicit colon commands and their redirects after a group", () => {
    expect(ShellScan.scan("(printf ok); : > output")).toMatchObject({
      kind: "scanned",
      commands: [
        { resource: "printf ok", words: ["printf", "ok"] },
        { resource: ": > output", words: [":"] },
      ],
    })
  })

  test("does not repeatedly rescan nested conditionals", () => {
    const source = Array.from({ length: 16 }).reduce<string>(
      (source) => `if true; then echo $(${source}); fi`,
      `printf ${"x".repeat(1024)}`,
    )
    expect(ShellScan.scan(source).kind).toBe("scanned")
    expect(ShellScan.scan("if true; then echo $(printf safe); fi")).toMatchObject({
      kind: "scanned",
      commands: [
        { resource: "true", words: ["true"] },
        { resource: "echo $(printf safe)", words: ["echo", "$(printf safe)"] },
        { resource: "printf safe", words: ["printf", "safe"] },
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
    expect(result.kind).toBe("scanned")
    if (result.kind === "opaque") throw new Error(result.reason)
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
    (source: string) => `\n\n${source}\n\n`,
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
      expect(result.kind).toBe("scanned")
      if (result.kind === "opaque") throw new Error(result.reason)
      for (const name of observed) expect(result.commands.map((command) => command.words[0])).toContain(name)
    })
  }
})

describe("Bash real-shell redirect-only statements", () => {
  for (const shell of ["bash", "zsh"]) {
    const executable = Bun.which(shell)
    test
      .skipIf(!executable)
      .each([
        "VALUE=ok >/dev/null; scan_probe",
        ">/dev/null; scan_probe",
        "(scan_probe) >/dev/null",
        "{ scan_probe; } >/dev/null",
        "{ scan_probe; } >$(scan_target)",
        "VALUE=ok >$(scan_target); scan_probe",
      ])(`${shell} preserves commands around redirect-only syntax: %s`, (source) => {
      const execution = Bun.spawnSync(
        [
          executable!,
          ...(shell === "bash" ? ["--noprofile", "--norc"] : ["-f"]),
          "-c",
          `scan_probe() { printf 'scan_probe\\n' >&2; }; scan_target() { printf 'scan_target\\n' >&2; printf /dev/null; }; ${source}`,
        ],
        { env: { PATH: "/usr/bin:/bin", LC_ALL: "C" } },
      )
      expect(execution.exitCode).toBe(0)
      expect(execution.stdout.toString()).toBe("")
      const observed = execution.stderr.toString().trim().split("\n").sort()
      expect(observed).toEqual(source.includes("scan_target") ? ["scan_probe", "scan_target"] : ["scan_probe"])
      const result = ShellScan.scan(source)
      expect(result.kind).toBe("scanned")
      if (result.kind === "opaque") return
      expect(result.commands.map((command) => command.words[0]).sort()).toEqual(observed)
    })
  }
})
