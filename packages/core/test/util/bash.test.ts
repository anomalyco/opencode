import { describe, expect, test } from "bun:test"
import { commands, parse, pathWords } from "@opencode-ai/core/util/bash"

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
