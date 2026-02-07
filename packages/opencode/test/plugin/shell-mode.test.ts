import { describe, expect, test } from "bun:test"
import { shouldRouteToShell } from "../../plugin/shell-mode/command-check"
import { detectNaturalLanguage } from "../../plugin/shell-mode/natural-language"

describe("shouldRouteToShell", () => {
  test("routes real commands to shell", async () => {
    expect(await shouldRouteToShell("ls")).toBe(true)
    expect(await shouldRouteToShell("echo hello")).toBe(true)
    expect(await shouldRouteToShell("git status")).toBe(true)
    expect(await shouldRouteToShell("cat foo.txt")).toBe(true)
  })

  test("does not route shell reserved words to shell", async () => {
    expect(await shouldRouteToShell("do We already have a way to uninstall?")).toBe(false)
    expect(await shouldRouteToShell("done with this task")).toBe(false)
    expect(await shouldRouteToShell("then what happens next")).toBe(false)
    expect(await shouldRouteToShell("else something")).toBe(false)
    expect(await shouldRouteToShell("elif something")).toBe(false)
    expect(await shouldRouteToShell("fi something")).toBe(false)
    expect(await shouldRouteToShell("esac something")).toBe(false)
    expect(await shouldRouteToShell("in the codebase")).toBe(false)
    expect(await shouldRouteToShell("function of this module")).toBe(false)
    expect(await shouldRouteToShell("select all users")).toBe(false)
  })

  test("does not route common English words to shell", async () => {
    // single-word conversational inputs
    expect(await shouldRouteToShell("perfect")).toBe(false)
    expect(await shouldRouteToShell("yes")).toBe(false)
    expect(await shouldRouteToShell("sure")).toBe(false)
    expect(await shouldRouteToShell("thanks")).toBe(false)
    expect(await shouldRouteToShell("great")).toBe(false)
    expect(await shouldRouteToShell("ok")).toBe(false)
    expect(await shouldRouteToShell("cool")).toBe(false)
    expect(await shouldRouteToShell("awesome")).toBe(false)
    expect(await shouldRouteToShell("nice")).toBe(false)
    expect(await shouldRouteToShell("stop")).toBe(false)
    expect(await shouldRouteToShell("why")).toBe(false)
    expect(await shouldRouteToShell("how")).toBe(false)
    expect(await shouldRouteToShell("lgtm")).toBe(false)
    // multi-word with agent word as first word
    expect(await shouldRouteToShell("perfect let's move on")).toBe(false)
    expect(await shouldRouteToShell("thanks for the help")).toBe(false)
    expect(await shouldRouteToShell("sure go ahead")).toBe(false)
    // case insensitive
    expect(await shouldRouteToShell("Perfect")).toBe(false)
    expect(await shouldRouteToShell("YES")).toBe(false)
  })

  test("does not route empty input to shell", async () => {
    expect(await shouldRouteToShell("")).toBe(false)
    expect(await shouldRouteToShell("  ")).toBe(false)
  })

  test("does not route unknown commands to shell", async () => {
    expect(await shouldRouteToShell("xyznonexistent something")).toBe(false)
    expect(await shouldRouteToShell("how do I install this")).toBe(false)
  })
})

describe("detectNaturalLanguage", () => {
  test("returns undefined for successful commands", () => {
    expect(detectNaturalLanguage("ls -la", "file1\nfile2", 0)).toBeUndefined()
  })

  test("returns undefined for null exit code", () => {
    expect(detectNaturalLanguage("ls -la", "error", null)).toBeUndefined()
  })

  test("returns undefined when second word is not an NL marker", () => {
    expect(detectNaturalLanguage("ls foo", "no such file or directory", 1)).toBeUndefined()
  })

  test("returns undefined for single-word inputs", () => {
    expect(detectNaturalLanguage("ls", "command failed", 1)).toBeUndefined()
  })

  test("detects natural language with parse errors", () => {
    expect(
      detectNaturalLanguage(
        "do We already have an easy way to uninstall lacy like lacy uninstall command?",
        "(eval):1: parse error near `do'",
        1,
      ),
    ).toBe(true)
  })

  test("detects natural language with command not found", () => {
    expect(
      detectNaturalLanguage("find out how the auth system works", "find: out: unknown primary or operator", 1),
    ).toBe(true)
  })

  test("detects natural language with make errors", () => {
    expect(
      detectNaturalLanguage(
        "make sure the tests pass before merging",
        "make: *** No rule to make target 'sure'.  Stop.",
        2,
      ),
    ).toBe(true)
  })

  test("detects natural language starting with git", () => {
    expect(
      detectNaturalLanguage(
        "git me the latest changes from the repo",
        "git: 'me' is not a git command. See 'git --help'.",
        1,
      ),
    ).toBe(true)
  })

  test("detects natural language with syntax errors and many words", () => {
    expect(
      detectNaturalLanguage(
        "while you are at it can you also fix the tests",
        "bash: syntax error near unexpected token `you'",
        2,
      ),
    ).toBe(true)
  })

  test("detects natural language with go subcommand errors", () => {
    expect(
      detectNaturalLanguage("go ahead and fix the tests", "go ahead: unknown command\nRun 'go help' for usage.", 2),
    ).toBe(true)
  })

  test("detects natural language with go for", () => {
    expect(detectNaturalLanguage("go for it and deploy", "go for: unknown command\nRun 'go help' for usage.", 2)).toBe(
      true,
    )
  })

  test("detects natural language with cargo errors", () => {
    expect(detectNaturalLanguage("cargo ahead with the release", "error: no such command: `ahead`", 101)).toBe(true)
  })

  test("detects natural language with docker errors", () => {
    expect(detectNaturalLanguage("docker is not working properly", "docker: unknown command: docker is", 1)).toBe(true)
  })

  test("detects 'find the file' with no such file error", () => {
    expect(
      detectNaturalLanguage(
        "find the file",
        "find: the: No such file or directory\nfind: file: No such file or directory",
        1,
      ),
    ).toBe(true)
  })

  test("detects 'go ahead' (2 words) with unknown command error", () => {
    expect(detectNaturalLanguage("go ahead", "go ahead: unknown command\nRun 'go help' for usage.", 2)).toBe(true)
  })

  test("detects 'what a catch' with no such file error", () => {
    expect(
      detectNaturalLanguage(
        "what a catch",
        "what: a: No such file or directory\nwhat: catch: No such file or directory",
        1,
      ),
    ).toBe(true)
  })

  test("returns undefined for real command errors", () => {
    // A real command that fails but isn't natural language
    expect(detectNaturalLanguage("grep -r foo", "grep: warning: recursive search of stdin", 1)).toBeUndefined()
  })

  test("returns undefined for real command with non-matching error", () => {
    // exit code 1 but output doesn't match error patterns
    expect(detectNaturalLanguage("cat file.txt bar.txt baz.txt", "some other output", 1)).toBeUndefined()
  })
})
