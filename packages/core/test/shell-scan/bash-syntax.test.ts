import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { ShellParse } from "../../src/shell/parse.js"
import { ShellScan } from "../../src/shell/scan.js"

const fixtures = [
  ["if true; then VALUE=$(scan_probe); fi", ["true", "scan_probe"]],
  ["if VALUE=$(scan_probe); then :; fi", ["scan_probe", ":"]],
  ["if true; then if false; then :; else scan_probe; fi; fi", ["true", "false", ":", "scan_probe"]],
  ["for value in one two; do if true; then scan_probe; fi; done", ["true", "scan_probe"]],
  ["for value in $(scan_probe); do :; done", ["scan_probe", ":"]],
  ["for ((i=0; i<1; i++)); do scan_probe; done", ["scan_probe"]],
  ["while false; do scan_probe; done; scan_after", ["false", "scan_probe", "scan_after"]],
  ["until true; do scan_probe; done; scan_after", ["true", "scan_probe", "scan_after"]],
  ["case value in value|other) scan_probe;; *) scan_after;; esac", ["scan_probe", "scan_after"]],
  ["case value in (value) case x in x) scan_probe;; esac;; esac", ["scan_probe"]],
  ["case if in if) scan_probe;; esac", ["scan_probe"]],
  ["case $(scan_probe) in value) :;; esac", ["scan_probe", ":"]],
  ["f() { case value in value) scan_probe;; esac; }; f", ["scan_probe", "f"]],
  ["function f { scan_probe; }; f", ["scan_probe", "f"]],
  ["f() (scan_probe); f", ["scan_probe", "f"]],
  ["printf ok; { scan_probe; } | scan_after", ["printf", "scan_probe", "scan_after"]],
  ["(scan_probe # ) ignored\nscan_after)", ["scan_probe", "scan_after"]],
  ["{ scan_probe; # } ignored\nscan_after; }", ["scan_probe", "scan_after"]],
  ["printf '%s' \"$(case value in value) scan_probe;; esac)\"", ["printf", "scan_probe"]],
  ["printf '%s' \"$(for value in one; do scan_probe; done)\"", ["printf", "scan_probe"]],
  ["printf '%s' \"$(printf %s case in; scan_probe)\"", ["printf", "printf", "scan_probe"]],
  ["cat <<EOF\nscan_ignored; $(scan_probe)\nEOF", ["cat", "scan_probe"]],
  ["cat <<'EOF'\nscan_ignored; $(scan_ignored)\nEOF", ["cat"]],
  ["cat <<\\EOF\n$(scan_ignored)\nEOF", ["cat"]],
  ["cat <<E'O'F\n$(scan_ignored)\nEOF", ["cat"]],
  ["cat <<-EOF\n\t$(scan_probe)\n\tEOF", ["cat", "scan_probe"]],
  ["cat <<EOF\n'$(scan_probe)'\nEOF", ["cat", "scan_probe"]],
  ["cat <<EOF\n\\$(scan_ignored)\nEOF", ["cat"]],
  ["cat <<EOF\n$(scan_probe)\nE\\\nOF\nscan_after", ["cat", "scan_probe", "scan_after"]],
  ["cat <<A <<'B'\n$(scan_probe)\nA\n$(scan_ignored)\nB\nscan_after", ["cat", "scan_probe", "scan_after"]],
  ["if cat <<EOF\n$(scan_probe)\nEOF\nthen scan_after; fi", ["cat", "scan_probe", "scan_after"]],
  ["printf '%s' \"$(cat <<EOF\n) $(scan_probe)\nEOF\n)\"", ["printf", "cat", "scan_probe"]],
  ["{ cat <<'EOF'\n} ignored\nEOF\nscan_probe; }", ["cat", "scan_probe"]],
  ['cat <<< "$(scan_probe)"', ["cat", "scan_probe"]],
  ["printf '%s' ${unset:-$(scan_probe)}", ["printf", "scan_probe"]],
  ["printf '%s' \"${unset:-'$(scan_probe)'}\"", ["printf", "scan_probe"]],
  ["printf '%s' ${unset:-'$(scan_ignored)'}", ["printf"]],
  ["printf '%s' \"${unset:-${other:-$(scan_probe)}}\"", ["printf", "scan_probe"]],
  ["printf '%s' \"${value%)}\"; scan_probe", ["printf", "scan_probe"]],
  ["printf '%s' \"${value//x/$(scan_probe)}\"", ["printf", "scan_probe"]],
  ["printf '%s' \"${array[$(scan_probe)]}\"", ["printf", "scan_probe"]],
  ["array[$(scan_probe)]=value; scan_after", ["scan_probe", "scan_after"]],
  ['array=(one "$(scan_probe)"); scan_after', ["scan_probe", "scan_after"]],
  ["array=(<(scan_probe)); scan_after", ["scan_probe", "scan_after"]],
  ["(( value = $(scan_probe) + 1 )); scan_after", ["scan_probe", "scan_after"]],
  ["printf '%s' $((array[$(scan_probe)] + 1))", ["printf", "scan_probe"]],
  ["printf '%s' $[1 + $(scan_probe)]", ["printf", "scan_probe"]],
  ["[[ $(scan_probe) = value ]] && scan_after", ["scan_probe", "scan_after"]],
  ["printf '%s' `printf \\2`; scan_probe", ["printf", "printf", "scan_probe"]],
  ["printf '%s' `printf \\`scan_probe\\``", ["printf", "printf", "scan_probe"]],
  ["printf '%s' $'literal\\\'$(scan_ignored)'; scan_probe", ["printf", "scan_probe"]],
  ['printf %s $"$(scan_probe)"', ["printf", "scan_probe"]],
  ["if true; then \\\nVALUE=$(scan_probe); fi", ["true", "scan_probe"]],
  ["! scan_probe", ["scan_probe"]],
  ["time scan_probe", ["time"]],
  ["{fd}>/dev/null scan_probe", ["scan_probe"]],
] as const

describe("ordinary Bash and Zsh syntax", () => {
  test.each(fixtures)("extracts actual command nodes: %s", (source, names) => {
    const result = ShellScan.scan(source)
    expect(result.kind).toBe("scanned")
    if (result.kind !== "scanned") throw new Error(result.reason)
    expect(result.commands.map((command) => command.words[0])).toEqual([...names])
  })

  for (const shell of ["bash", "zsh"]) {
    const executable = Bun.which(shell)
    for (const [source] of fixtures) {
      // These are Bash spellings; Zsh's fd allocation is a standalone statement.
      test.skipIf(
        !executable ||
          (shell === "zsh" && (source.includes('$"') || source.startsWith("{fd}") || source.includes("$["))),
      )(`${shell} accepts the source grammar: ${source}`, () => {
        const result = Bun.spawnSync([
          executable ?? shell,
          ...(shell === "bash" ? ["--noprofile", "--norc"] : ["-f"]),
          "-n",
          "-c",
          source + "\n:",
        ])
        expect(result.stderr.toString()).toBe("")
        // Zsh negates the skipped command's status even under NOEXEC.
        expect(result.exitCode).toBe(shell === "zsh" && source.startsWith("! ") ? 1 : 0)
      })
    }

    test
      .skipIf(!executable)
      .each([
        "if true; then VALUE=$(scan_probe); fi",
        "for value in one; do if true; then scan_probe; fi; done",
        "f() { case value in value) scan_probe;; esac; }; f",
        "printf '%s' \"$(case value in (value) scan_probe;; esac)\"",
        "cat <<EOF\n'$(scan_probe)'\nEOF",
        "cat <<A <<'B'\n$(scan_probe)\nA\n$(scan_ignored)\nB",
        'cat <<< "$(scan_probe)"',
        "printf '%s' \"${unset:-'$(scan_probe)'}\"",
        "printf '%s' `printf \\`scan_probe\\``",
        'array=(one "$(scan_probe)"); :',
        "(( value = $(scan_probe) + 1 )); :",
      ])(`${shell} runs only the explicitly found probes: %s`, (source) => {
      const execution = Bun.spawnSync(
        [
          executable ?? shell,
          ...(shell === "bash" ? ["--noprofile", "--norc"] : ["-f"]),
          "-c",
          `scan_probe() { printf 'scan_probe\\n' >&2; printf 1; }; scan_ignored() { printf 'unexpected\\n' >&2; }; ${source}`,
        ],
        { env: { PATH: "/usr/bin:/bin", LC_ALL: "C" } },
      )
      expect(execution.exitCode).toBe(0)
      expect(execution.stderr.toString()).toBe("scan_probe\n")
      const result = ShellScan.scan(source)
      expect(result.kind).toBe("scanned")
      if (result.kind !== "scanned") throw new Error(result.reason)
      expect(result.commands.filter((command) => command.words[0] === "scan_probe")).toHaveLength(1)
      expect(result.commands.some((command) => command.words[0] === "scan_ignored")).toBe(false)
    })
  }

  test.each([
    "for value in one; do",
    "while true; done",
    "case value in x) echo ok",
    "cat <<EOF\nunclosed",
    "echo ${missing",
    "echo $'missing",
  ])("rejects incomplete syntax: %s", (source) => {
    expect(ShellScan.scan(source).kind).toBe("opaque")
  })

  test("preserves raw lexical spelling of ANSI-C and locale quoted words", () => {
    expect(ShellScan.scan("$'pri\\x6etf' $'line\\n' $\"text\"")).toMatchObject({
      kind: "scanned",
      commands: [{ words: ["printf", "line\n", "text"], rawWords: ["$'pri\\x6etf'", "$'line\\n'", '$"text"'] }],
    })
  })

  test.each([
    ["coproc job { scan_probe; }", ["scan_probe"]],
    ["printf '%s' @(one|$(scan_probe))", ["printf", "scan_probe"]],
    ["printf '%s' $((1 + '$(scan_probe)'))", ["printf", "scan_probe"]],
    ["printf '%s' $(((1 + '$(scan_probe)')))", ["printf", "scan_probe"]],
    ['printf %s "${ scan_probe; }"', ["printf", "scan_probe"]],
    ['printf %s "${|scan_probe; }"', ["printf", "scan_probe"]],
  ] as const)("retains explicit substitutions without evaluating expressions: %s", (source, names) => {
    const result = ShellScan.scan(source)
    expect(result.kind).toBe("scanned")
    if (result.kind !== "scanned") throw new Error(result.reason)
    expect(result.commands.map((command) => command.words[0])).toEqual([...names])
  })
})

describe("Bash shared heredoc delimiter grammar", () => {
  test.each([
    '(cat <<"E\\OF"\nhello\nE\\OF\n)',
    'cat <<"E\\$OF"\nhello\nE$OF',
    '(cat <<"E\\$OF"\nhello\nE$OF\n)',
    '(cat <<-"E\\OF"\n\thello\n\tE\\OF\n)',
  ])("preserves heredoc permission resources and saved prefixes: %s", async (source) => {
    const legacy = await Effect.runPromise(ShellParse.scan(source, "/bin/bash", "/workspace"))
    expect(await Effect.runPromise(ShellParse.scanPortable(source, "/bin/bash", "/workspace"))).toEqual(legacy)
  })

  test.each([
    ["cat <<< hello\nprintf done", ["cat", "printf"]],
    ["(cat <<< hello\nprintf done)", ["cat", "printf"]],
    ['printf %s "$(cat <<< hello\nprintf done)"', ["printf", "cat", "printf"]],
    ['(cat <<< "$(printf hello)"\nprintf done)', ["cat", "printf", "printf"]],
  ] as const)("does not reinterpret the tail of a here-string operator: %s", async (source, names) => {
    const result = ShellScan.scan(source)
    expect(result.kind).toBe("scanned")
    if (result.kind !== "scanned") throw new Error(result.reason)
    expect(result.commands.map((command) => command.words[0])).toEqual([...names])
    const legacy = await Effect.runPromise(ShellParse.scan(source, "/bin/bash", "/workspace"))
    expect(await Effect.runPromise(ShellParse.scanPortable(source, "/bin/bash", "/workspace"))).toEqual(legacy)
  })

  test.each([
    ['<<"E\\OF"', "E\\OF", true, false],
    ['<<"E\\$OF"', "E$OF", true, false],
    ['<<"E\\`OF"', "E`OF", true, false],
    ['<<"E\\\"OF"', 'E"OF', true, false],
    ['<<"E\\\\OF"', "E\\OF", true, false],
    ["<<'E\\OF'", "E\\OF", true, false],
    ["<<E\\OF", "EOF", true, false],
    ["<<''", "", true, false],
    ["<<$'E\\x4fF'", "EOF", true, false],
    ["<<EO\\\nF", "EOF", false, false],
    ["<<-EOF", "EOF", false, true],
    ['<<-"E\\OF"', "E\\OF", true, true],
  ] as const)("uses identical delimiter decoding in every command context: %j", (header, delimiter, quoted, tabs) => {
    const body = `cat ${header}\n${tabs ? "\t" : ""}$(printf probe)\n${tabs ? "\t" : ""}${delimiter}`
    for (const source of [body + "\nprintf done", `(${body}\nprintf done)`, `printf %s "$(${body}\nprintf done)"`]) {
      const result = ShellScan.scan(source)
      expect(result.kind).toBe("scanned")
      if (result.kind !== "scanned") throw new Error(result.reason)
      expect(result.commands.map((command) => command.words[0])).toEqual([
        ...(source.startsWith("printf") ? ["printf"] : []),
        "cat",
        ...(quoted ? [] : ["printf"]),
        "printf",
      ])
      expect(result.commands.find((command) => command.words[0] === "cat")).toEqual({
        resource: body.trim(),
        words: ["cat"],
        rawWords: ["cat"],
      })
      if (!quoted) expect(result.commands.some((command) => command.resource === "printf probe")).toBe(true)
    }
  })

  const bash = Bun.which("bash")
  test
    .skipIf(!bash)
    .each([
      "(cat <<< hello\nprintf done)",
      'printf %s "$(cat <<< hello\nprintf done)"',
      '(cat <<"E\\OF"\n$(scan_probe)\nE\\OF\nprintf done)',
      '(cat <<"E\\$OF"\n$(scan_probe)\nE$OF\nprintf done)',
      "(cat <<''\n$(scan_probe)\n\nprintf done)",
      "(cat <<$'E\\x4fF'\n$(scan_probe)\nEOF\nprintf done)",
      '(cat <<-"E\\OF"\n\t$(scan_probe)\n\tE\\OF\nprintf done)',
      "(cat <<EO\\\nF\n$(scan_probe)\nEOF\nprintf done)",
    ])("real Bash agrees with delimiter quoting: %s", (source) => {
    const execution = Bun.spawnSync(
      [bash!, "--noprofile", "--norc", "-c", `scan_probe() { printf 'executed\\n' >&2; }; ${source}`],
      { env: { PATH: "/usr/bin:/bin", LC_ALL: "C" } },
    )
    expect(execution.exitCode).toBe(0)
    expect(execution.stderr.toString()).toBe(source.includes("<<EO\\\nF") ? "executed\n" : "")
    expect(execution.stdout.toString()).toBe(
      source.includes("<<<") ? "hello\ndone" : source.includes("<<EO\\\nF") ? "\ndone" : "$(scan_probe)\ndone",
    )
  })
})
