import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { ShellParse } from "../../src/shell/parse.js"
import { ShellScan } from "../../src/shell/scan.js"
import { Wildcard } from "../../src/util/wildcard.js"

async function parity(source: string) {
  const legacy = await Effect.runPromise(ShellParse.scan(source, "/bin/bash", "/workspace"))
  const native = await Effect.runPromise(ShellParse.scanPortable(source, "/bin/bash", "/workspace"))
  expect(native, source).toEqual(legacy)
}

describe("Bash redirect resource oracle", () => {
  test.each([
    ["printf hello | cat > marker", ["printf hello", "cat"]],
    ["printf ok && git status > output", ["printf ok", "git status"]],
    ["cat > output", ["cat > output"]],
    ["cat > output | cat", ["cat > output", "cat"]],
    ["pwd | > output cat > tail", ["pwd", "> output cat"]],
    ["pwd && cat > output file", ["pwd", "cat"]],
    ["pwd; cat > output", ["pwd", "cat > output"]],
    ["pwd\ncat > output", ["pwd", "cat > output"]],
  ] as const)("matches exact permission resources: %s", async (source, resources) => {
    const legacy = await Effect.runPromise(ShellParse.scan(source, "/bin/bash", "/workspace"))
    expect(legacy.commands.map((command) => command.resource)).toEqual([...resources])
    await parity(source)
  })

  test("matches redirect positions across generated list and pipeline boundaries", async () => {
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
        await parity(command)
        for (const separator of separators) {
          await parity(`printf ok${separator}${command}`)
          await parity(`${command}${separator}pwd >last`)
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
    "pwd && cd >out /outside",
    "time git status",
    "time -p git status",
    "coproc git status",
  ])("preserves nested commands, prefixes, and context: %s", parity)

  test("keeps lexical words and nested redirect-target commands after narrowing the resource", () => {
    const result = ShellScan.scan('pwd | git >"$(printf output)" status')
    expect(result.kind).toBe("scanned")
    if (result.kind !== "scanned") throw new Error(`Unexpected opacity: ${result.reason}`)
    expect(result.commands[1]).toMatchObject({
      resource: "git",
      words: ["git", "status"],
      rawWords: ["git", "status"],
      redirectWordCount: 1,
    })
    expect(result.commands[2]).toMatchObject({ resource: "printf output", rawWords: ["printf", "output"] })
  })

  test("excludes ignored trailing continuations from narrowed command prefixes", async () => {
    const source = "pwd | cat\\\n >out"
    const legacy = await Effect.runPromise(ShellParse.scan(source, "/bin/bash", "/workspace"))
    const result = ShellScan.scan(source)
    expect(result.kind).toBe("scanned")
    if (result.kind !== "scanned") throw new Error(`Unexpected opacity: ${result.reason}`)
    expect(result.commands.map((command) => command.resource)).toEqual(
      legacy.commands.map((command) => command.resource),
    )
    expect(result.commands[1]?.rawWords).toEqual(["cat"])
    expect(legacy.commands[1]).toEqual({ resource: "cat", save: "cat *" })
    const native = await Effect.runPromise(ShellParse.scanPortable(source, "/bin/bash", "/workspace"))
    expect(native).toEqual(legacy)
    expect(native.commands.every((command) => Wildcard.match(command.resource, command.save))).toBe(true)
  })

  test.each(["cat\\\n", "cat \\\n", "cat\\\n\\\n", "cat\\\n;", "cat >out\\\n", "cat >out \\\n"])(
    "saved prefixes cover their standalone continuation command: %j",
    async (source) => {
      await parity(source)
      const result = ShellScan.scan(source)
      expect(result.kind).toBe("scanned")
      if (result.kind !== "scanned") throw new Error(result.reason)
      expect(result.commands[0]?.rawWords).toEqual(["cat"])
      const native = await Effect.runPromise(ShellParse.scanPortable(source, "/bin/bash", "/workspace"))
      expect(native.commands[0]).toEqual({ resource: source.includes(">out") ? "cat >out" : "cat", save: "cat *" })
      expect(native.commands.every((command) => Wildcard.match(command.resource, command.save))).toBe(true)
    },
  )

  test.each(["printf 'literal\\\n'\\\n", 'printf "literal\\\n"\\\n', "printf a\\\nb\\\n", 'printf a\\\n""\\\n'])(
    "preserves meaningful raw syntax before an ignored trailing continuation: %j",
    async (source) => {
      await parity(source)
      const result = ShellScan.scan(source)
      expect(result.kind).toBe("scanned")
      if (result.kind !== "scanned") throw new Error(result.reason)
      expect(result.commands[0]?.resource).toBe(source.slice(0, -2))
      expect(result.commands[0]?.rawWords).toEqual(["printf", source.slice("printf ".length, -2)])
    },
  )

  test("known gap: assignment then redirect on a pipeline RHS retains the native command", async () => {
    const source = "printf ok | FOO=bar >output git status 3>tail"
    const legacy = await Effect.runPromise(ShellParse.scan(source, "/bin/bash", "/workspace"))
    const native = await Effect.runPromise(ShellParse.scanPortable(source, "/bin/bash", "/workspace"))
    expect(legacy.commands).toEqual([{ resource: "printf ok", save: "printf *" }])
    expect(native.commands).toEqual([
      { resource: "printf ok", save: "printf *" },
      { resource: "FOO=bar >output git status", save: "git status *" },
    ])
  })
})
