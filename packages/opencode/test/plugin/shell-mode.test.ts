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

  test("returns undefined for short inputs even with errors", () => {
    expect(detectNaturalLanguage("ls foo", "no such file or directory", 1)).toBeUndefined()
  })

  test("detects natural language with parse errors", () => {
    const hint = detectNaturalLanguage(
      "do We already have an easy way to uninstall lacy like lacy uninstall command?",
      "(eval):1: parse error near `do'",
      1,
    )
    expect(hint).toBeDefined()
    expect(hint).toContain("agent")
  })

  test("detects natural language with command not found", () => {
    const hint = detectNaturalLanguage(
      "find out how the auth system works",
      "find: out: unknown primary or operator",
      1,
    )
    expect(hint).toBeDefined()
    expect(hint).toContain("agent")
  })

  test("detects natural language with make errors", () => {
    const hint = detectNaturalLanguage(
      "make sure the tests pass before merging",
      "make: *** No rule to make target 'sure'.  Stop.",
      2,
    )
    expect(hint).toBeDefined()
    expect(hint).toContain("agent")
  })

  test("detects natural language starting with git", () => {
    const hint = detectNaturalLanguage(
      "git me the latest changes from the repo",
      "git: 'me' is not a git command. See 'git --help'.",
      1,
    )
    expect(hint).toBeDefined()
    expect(hint).toContain("agent")
  })

  test("detects natural language with syntax errors and many words", () => {
    const hint = detectNaturalLanguage(
      "while you are at it can you also fix the tests",
      "bash: syntax error near unexpected token `you'",
      2,
    )
    expect(hint).toBeDefined()
    expect(hint).toContain("agent")
  })

  test("detects natural language with go subcommand errors", () => {
    const hint = detectNaturalLanguage(
      "go ahead and fix the tests",
      "go ahead: unknown command\nRun 'go help' for usage.",
      2,
    )
    expect(hint).toBeDefined()
    expect(hint).toContain("agent")
  })

  test("detects natural language with go for", () => {
    const hint = detectNaturalLanguage("go for it and deploy", "go for: unknown command\nRun 'go help' for usage.", 2)
    expect(hint).toBeDefined()
    expect(hint).toContain("agent")
  })

  test("detects natural language with cargo errors", () => {
    const hint = detectNaturalLanguage("cargo ahead with the release", "error: no such command: `ahead`", 101)
    expect(hint).toBeDefined()
    expect(hint).toContain("agent")
  })

  test("detects natural language with docker errors", () => {
    const hint = detectNaturalLanguage("docker is not working properly", "docker: unknown command: docker is", 1)
    expect(hint).toBeDefined()
    expect(hint).toContain("agent")
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
