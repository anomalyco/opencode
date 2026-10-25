import { describe, expect, test } from "bun:test"
import { ShellScan } from "../../src/shell/scan.js"

describe("Bash arithmetic expansions", () => {
  test.each([
    "$((1+1))",
    "$((1 + 1))",
    "$(((1 + 2) * (3 + (4))))",
    "$((value + $other + ${third}))",
    "$((value += 2, value > 1 ? value << 2 : ~value))",
    "$((16#ff & 0xff | 2 ** 3))",
    "$((1 + $((2 * 3))))",
    "$((1 + \\\n2))",
    "$((1 +\n2))",
    "$((1 + ${value:-2}))",
    "$((array[index]))",
    "$((1 + $[2]))",
    '$((1 + "2"))',
    "$((1 + '2'))",
  ])("preserves arithmetic without evaluating it: %s", (expression) => {
    for (const argument of [expression, `"${expression}"`]) {
      expect(ShellScan.scan(`echo ${argument}`)).toEqual({
        kind: "scanned",
        commands: [{ resource: `echo ${argument}`, words: ["echo", expression], rawWords: ["echo", argument] }],
      })
    }
  })

  test.each([
    "$((1 + $(printf 2)))",
    "$((1 + `printf 2`))",
    "$((1 + $((2 * $(printf 2)))))",
    '$((1 + $(printf "%s" "$(printf 2)")))',
    "$((array[$(printf 2)]))",
    "$((1 + `printf \\2`))",
  ])("reports explicit commands inside arithmetic: %s", (expression) => {
    for (const argument of [expression, `"${expression}"`]) {
      const result = ShellScan.scan(`echo ${argument}; pwd`)
      expect(result.kind).toBe("scanned")
      if (result.kind === "opaque") return
      expect(result.commands[0]).toEqual({
        resource: `echo ${argument}`,
        words: ["echo", expression],
        rawWords: ["echo", argument],
      })
      expect(result.commands.slice(1, -1).map((command) => command.words[0])).toEqual(
        expression.includes('"$(printf') ? ["printf", "printf"] : ["printf"],
      )
      expect(result.commands.at(-1)).toEqual({ resource: "pwd", words: ["pwd"], rawWords: ["pwd"] })
    }
  })

  test.each([
    'VALUE=$((1 + $(printf 2))) echo ok >"$((3 + $(printf 4)))"',
    'echo "$(echo $((1 + $(printf 2))))"',
    '{ echo "$((1 + $(printf 2)))"; }',
    '(echo "$((1 + $(printf 2)))")',
    'if true; then echo "$((1 + $(printf 2)))"; fi',
  ])("recognizes arithmetic in existing shell contexts: %s", (source) => {
    const result = ShellScan.scan(source)
    expect(result.kind).toBe("scanned")
    if (result.kind === "opaque") return
    expect(result.commands.map((command) => command.words[0])).toContain("printf")
    expect(result.commands.map((command) => command.words[0])).toContain("echo")
  })

  test("does not expand arithmetic inside single quotes", () => {
    expect(ShellScan.scan("echo '$((1 + $(ignored)))'")).toEqual({
      kind: "scanned",
      commands: [
        {
          resource: "echo '$((1 + $(ignored)))'",
          words: ["echo", "$((1 + $(ignored)))"],
          rawWords: ["echo", "'$((1 + $(ignored)))'"],
        },
      ],
    })
  })

  test.each([
    "echo $((1 + 2)",
    "echo $(((1 + 2))",
    "echo $((1 + $(printf 2))) &&",
    "echo $((1 + $(printf 2 &&)))",
    "echo $((1; printf 2))",
  ])("rejects malformed arithmetic syntax: %s", (source) => {
    expect(ShellScan.scan(source).kind).toBe("opaque")
  })

  test("bounds arithmetic nesting, input size, and repeated conditional work", () => {
    expect(ShellScan.scan(`echo $((${"(".repeat(33)}1${")".repeat(33)}))`).kind).toBe("opaque")
    expect(ShellScan.scan(`echo ${"$((".repeat(33)}1${"))".repeat(33)}`).kind).toBe("opaque")
    expect(ShellScan.scan(`echo $((${"1+".repeat(32 * 1024)}1))`).kind).toBe("opaque")
    const source = Array.from({ length: 16 }).reduce<string>(
      (source) => `if true; then echo $((1 + $(${source}))); fi`,
      `printf ${"1".repeat(1024)}`,
    )
    expect(ShellScan.scan(source).kind).toBe("scanned")
    expect(ShellScan.scan("echo $((1+1))").kind).toBe("scanned")
  })
})

describe("Bash arithmetic real-shell oracle", () => {
  const expressions = [
    ["$((1+1))", "2"],
    ["$(((1 + 2) * (3 + (4))))", "21"],
    ["$((value + $other + ${third}))", "9"],
    ["$((value += 2, value > 1 ? value << 2 : ~value))", "16"],
    ["$(((16#ff & 0xff) | (2 ** 3)))", "255"],
    ["$((1 + $((2 * 3))))", "7"],
    ["$((1 + $(scan_probe)))", "3"],
    ["$((1 + `scan_probe`))", "3"],
    ["$(((1 + $(scan_probe)) * $((2 + $(scan_probe)))))", "12"],
    ['$((1 + $(printf "%s" "$(scan_probe)")))', "3"],
  ] as const

  for (const shell of ["bash", "zsh"]) {
    const executable = Bun.which(shell)
    test.skipIf(!executable).each(expressions)(`${shell} evaluates %s independently`, (expression, output) => {
      for (const argument of [expression, `"${expression}"`]) {
        const source = `value=2; other=3; third=4; printf '%s\\n' ${argument}`
        const execution = Bun.spawnSync(
          [
            executable!,
            ...(shell === "bash" ? ["--noprofile", "--norc"] : ["-f"]),
            "-c",
            `scan_probe() { printf 'scan_probe\\n' >&2; printf 2; }; ${source}`,
          ],
          { env: { PATH: "/usr/bin:/bin", LC_ALL: "C" } },
        )
        expect(execution.exitCode).toBe(0)
        expect(execution.stdout.toString()).toBe(`${output}\n`)
        const result = ShellScan.scan(source)
        expect(result.kind).toBe("scanned")
        if (result.kind === "opaque") return
        const observed = execution.stderr.toString().trim().split("\n").filter(Boolean)
        expect(observed).toEqual(Array.from({ length: expression.split("scan_probe").length - 1 }, () => "scan_probe"))
        expect(result.commands.filter((command) => command.words[0] === "scan_probe")).toHaveLength(observed.length)
        expect(result.commands[0]?.words).toEqual(["printf", "%s\\n", expression])
      }
    })
  }
})
