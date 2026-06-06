import { describe, expect, test } from "bun:test"
import { commandParts, commands, parse, pathWords } from "@opencode-ai/core/util/bash"

const norm = (command: string) => commandParts(command).map((c) => ({ tokens: c.parts.map((p) => p.text), source: c.source }))

describe("util/bash", () => {
  test("returns command name and suffix words", () => {
    expect(pathWords("cat /etc/hosts")).toEqual(["cat", "/etc/hosts"])
    expect(pathWords("/usr/bin/cat foo")).toEqual(["/usr/bin/cat", "foo"])
  })

  test("unquotes words, preserving embedded spaces", () => {
    expect(pathWords(`cat "/a b/c"`)).toContain("/a b/c")
  })

  test("splits compound commands structurally instead of by token", () => {
    expect(pathWords("cat /etc/x && rm /tmp/y ; head /var/z")).toEqual(
      expect.arrayContaining(["/etc/x", "/tmp/y", "/var/z"]),
    )
  })

  test("descends into command substitutions", () => {
    expect(pathWords(`echo "$(rm -rf /tmp/z)"`)).toContain("/tmp/z")
    expect([...commands(parse(`echo "$(rm -rf /tmp/z)"`))].map((c) => c.name?.value)).toEqual(["echo", "rm"])
  })

  test("excludes dynamic words so unresolved expansions are not treated as paths", () => {
    const words = pathWords("cat $HOME/x /abs/$VAR $(echo /etc)/y")
    expect(words).not.toContain("$HOME/x")
    expect(words).not.toContain("/abs/$VAR")
    expect(words).not.toContain("$(echo /etc)/y")
    expect(words).toContain("/etc")
  })

  test("parses tolerantly without throwing on malformed input", () => {
    expect(() => parse(`cat "unterminated`)).not.toThrow()
    expect(() => pathWords("for do done |&")).not.toThrow()
  })
})

describe("util/bash commandParts", () => {
  test("keeps each command's source, including redirects and assignment prefixes", () => {
    expect(norm(`FOO=bar rm -rf /tmp/x`)).toEqual([{ tokens: ["rm", "-rf", "/tmp/x"], source: "FOO=bar rm -rf /tmp/x" }])
    expect(norm(`cat a.txt | grep foo > out.log`)).toEqual([
      { tokens: ["cat", "a.txt"], source: "cat a.txt" },
      { tokens: ["grep", "foo"], source: "grep foo > out.log" },
    ])
  })

  test("reconstructs nested source for commands inside substitutions", () => {
    expect(norm(`echo "hi $(rm -rf /tmp/z)"`)).toEqual([
      { tokens: ["echo", `"hi $(rm -rf /tmp/z)"`], source: `echo "hi $(rm -rf /tmp/z)"` },
      { tokens: ["rm", "-rf", "/tmp/z"], source: "rm -rf /tmp/z" },
    ])
  })

  test("drops bare-expansion tokens but keeps brace expansions and quoted strings", () => {
    expect(norm(`echo $(date) {a,b} "$HOME/x"`)).toEqual([
      { tokens: ["echo", "{a,b}", `"$HOME/x"`], source: `echo $(date) {a,b} "$HOME/x"` },
      { tokens: ["date"], source: "date" },
    ])
  })

  test("omits the `[` test builtin to mirror tree-sitter", () => {
    expect(norm(`[ -f x ] && rm x`)).toEqual([{ tokens: ["rm", "x"], source: "rm x" }])
  })
})
