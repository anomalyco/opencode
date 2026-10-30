import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { ShellParse } from "../../src/shell/parse.js"
import { ShellScan } from "../../src/shell/scan.js"
import { Wildcard } from "../../src/util/wildcard.js"

async function checkResources(source: string) {
  const parsed = await Effect.runPromise(ShellParse.scan(source, "/bin/bash", "/workspace"))
  for (const command of parsed.commands) {
    if (
      !/^[A-Za-z_][A-Za-z0-9_]*=/.test(command.resource) &&
      !/^(?:\d*>>?|\d*>&|&>>?|\d*<|\d*<>|>\|)/.test(command.resource) &&
      !command.resource.includes("\\\n")
    ) {
      expect(Wildcard.match(command.resource, command.save), `${source}: ${JSON.stringify(command)}`).toBe(true)
    }
  }
}

describe("Bash redirect resource oracle", () => {
  test.each([
    ["printf hello | cat > marker", ["printf hello", "cat > marker"]],
    ["printf ok && git status > output", ["printf ok", "git status > output"]],
    ["cat > output", ["cat > output"]],
    ["cat > output | cat", ["cat > output", "cat"]],
    ["pwd | > output cat > tail", ["pwd", "> output cat > tail"]],
    ["pwd && cat > output file", ["pwd", "cat > output file"]],
    ["pwd; cat > output", ["pwd", "cat > output"]],
    ["pwd\ncat > output", ["pwd", "cat > output"]],
  ] as const)("keeps redirects visible across lists and pipelines: %s", async (source, resources) => {
    const parsed = await Effect.runPromise(ShellParse.scan(source, "/bin/bash", "/workspace"))
    expect(parsed.commands.map((command) => command.resource)).toEqual([...resources])
    await checkResources(source)
  })

  test("scans redirect positions across generated list and pipeline boundaries", async () => {
    const redirects = [">output", ">>output", "<input", "2>err", "2>&1", "<&0", ">|output", "&>output", "&>>output"]
    const separators = [" | ", " |& ", " && ", " || ", "; ", " & ", "\n"]
    for (const redirect of redirects) {
      for (const command of [
        `${redirect} git status`,
        `git ${redirect} status`,
        `git status ${redirect}`,
        `${redirect} git status 3>tail`,
        `${redirect} FOO=bar git status 3>tail`,
        `npm run ${redirect} test`,
      ]) {
        // Dash reads `&>` as `&` and `>`, so words after its target start another command there.
        if (redirect.startsWith("&") && !command.endsWith(redirect)) {
          expect(ShellScan.scan(command).kind).toBe("opaque")
          continue
        }
        await checkResources(command)
        for (const separator of separators) {
          await checkResources(`printf ok${separator}${command}`)
          await checkResources(`${command}${separator}pwd >last`)
        }
      }
    }
  })

  test.each([
    "pwd | cat >out | tail >log",
    "pwd && cat >out || tail >log",
    "pwd && cat >out | tail >log",
    "pwd | cat >out && tail >log",
    "pwd |\n\n# comment\ncat >out",
    "pwd &&\n# comment\ncat >out",
    "pwd | cat >out # comment\ncat >log",
    "pwd | cat # comment\n>out cat",
    "pwd | cat \\\n 2>out",
    "pwd | cat a\\\n>out",
    "pwd | cat 2\\\n>out",
    "pwd && FOO=bar >output git status 3>tail",
    "(cat >out) | tail >log",
    "{ cat >out; } && tail >log",
    "(pwd | cat >out) >group",
    "(cat >out) >$(printf log) && cat >tail",
    "(cat >out); cat >tail",
    "echo $(pwd | cat >out) >outer",
    'echo "$(pwd && cat >out)" | cat >outer',
    "echo `pwd | cat >out` >outer",
    "pwd | cat >$(printf out)",
    'pwd | cat >"$(printf out)"',
    "pwd | cat >$(printf out | cat >inner)",
    "pwd | cat >out $(printf arg) >tail",
    "pwd | cat <(printf input) > >(cat >log)",
    "cat <(pwd | cat >out) | cat >tail",
    "pwd | cat >out <(printf arg) >tail",
    "pwd | cat '>' \"2>out\" escaped\\>word >out",
    "pwd | cat '2'>out",
    "pwd | cat 2\\>out",
    "if true; then printf ok && cat >$(printf path); fi",
    "if true; then printf ok && git >out status; else cat >log; fi",
    "time git status",
    "time -p git status",
    "coproc git status",
  ])("preserves nested commands, prefixes, and context: %s", checkResources)

  test("keeps full redirect resource, lexical words, and nested redirect-target commands", async () => {
    const source = 'pwd | git >"$(printf output)" status'
    const result = ShellScan.scan(source)
    expect(result.kind).toBe("scanned")
    if (result.kind !== "scanned") throw new Error(`Unexpected opacity: ${result.reason}`)
    expect(result.commands[1]).toMatchObject({
      resource: 'git >"$(printf output)" status',
      words: ["git", "status"],
      rawWords: ["git", "status"],
      redirectWordCount: 1,
    })
    expect(result.commands[2]).toMatchObject({ resource: "printf output", rawWords: ["printf", "output"] })
    const parsed = await Effect.runPromise(ShellParse.scan(source, "/bin/bash", "/workspace"))
    expect(parsed.commands[1]).toEqual({ resource: 'git >"$(printf output)" status', save: "git *" })
    expect(Wildcard.match(parsed.commands[1]!.resource, parsed.commands[1]!.save)).toBe(true)
  })

  test("retains trailing redirect span after a continuation on pipeline RHS", async () => {
    const source = "pwd | cat\\\n >out"
    const result = ShellScan.scan(source)
    expect(result.kind).toBe("scanned")
    if (result.kind !== "scanned") throw new Error(`Unexpected opacity: ${result.reason}`)
    expect(result.commands[1]?.rawWords).toEqual(["cat"])
    const parsed = await Effect.runPromise(ShellParse.scan(source, "/bin/bash", "/workspace"))
    expect(parsed.commands).toEqual([
      { resource: "pwd", save: "pwd *" },
      { resource: "cat\\\n >out", save: "cat *" },
    ])
  })

  test.each(["cat\\\n", "cat \\\n", "cat\\\n\\\n", "cat\\\n;", "cat >out\\\n", "cat >out \\\n"])(
    "saved prefixes cover their standalone continuation command: %j",
    async (source) => {
      const result = ShellScan.scan(source)
      expect(result.kind).toBe("scanned")
      if (result.kind !== "scanned") throw new Error(result.reason)
      expect(result.commands[0]?.rawWords).toEqual(["cat"])
      const parsed = await Effect.runPromise(ShellParse.scan(source, "/bin/bash", "/workspace"))
      expect(parsed.commands[0]).toEqual({ resource: source.includes(">out") ? "cat >out" : "cat", save: "cat *" })
      expect(parsed.commands.every((command) => Wildcard.match(command.resource, command.save))).toBe(true)
    },
  )

  test.each(["printf 'literal\\\n'\\\n", 'printf "literal\\\n"\\\n', "printf a\\\nb\\\n", 'printf a\\\n""\\\n'])(
    "preserves meaningful raw syntax before an ignored trailing continuation: %j",
    async (source) => {
      const result = ShellScan.scan(source)
      expect(result.kind).toBe("scanned")
      if (result.kind !== "scanned") throw new Error(result.reason)
      expect(result.commands[0]?.resource).toBe(source.slice(0, -2))
      expect(result.commands[0]?.rawWords).toEqual(["printf", source.slice("printf ".length, -2)])
    },
  )

  test("assignment then redirect on a pipeline RHS retains the full command and trailing redirect", async () => {
    const source = "printf ok | FOO=bar >output git status 3>tail"
    const parsed = await Effect.runPromise(ShellParse.scan(source, "/bin/bash", "/workspace"))
    expect(parsed.commands).toEqual([
      { resource: "printf ok", save: "printf *" },
      { resource: "FOO=bar >output git status 3>tail", save: "git status *" },
    ])
  })

  test("redirect before cd operand retains the target directory", async () => {
    const source = "pwd && cd >out /outside"
    const parsed = await Effect.runPromise(ShellParse.scan(source, "/bin/bash", "/workspace"))
    expect(parsed).toEqual({ commands: [{ resource: "pwd", save: "pwd *" }], directories: ["/outside"] })
  })
})
