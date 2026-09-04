import { test, expect, describe } from "bun:test"
import { CompletionCommand, detectShell, generateCompletionScript } from "@/cli/cmd/completion"

describe("completion command", () => {
  test("registers with a positional shell argument", () => {
    expect(CompletionCommand.command).toBe("completion [shell]")
    expect(CompletionCommand.describe).toBe("generate shell completion script")
  })

  test("fish template is valid fish syntax", () => {
    const script = generateCompletionScript("fish")
    expect(script).toContain("complete -f -c opencode -a '(opencode --get-yargs-completions (commandline -o)[2..-1])'")
    // no bash constructs
    expect(script).not.toContain("COMP_WORDS")
    expect(script).not.toContain("mapfile")
  })

  test("zsh template starts with compdef header", () => {
    const script = generateCompletionScript("zsh")
    expect(script.startsWith("#compdef opencode")).toBe(true)
    expect(script).toContain("compdef _opencode_yargs_completions opencode")
  })

  test("bash template registers the completion function", () => {
    const script = generateCompletionScript("bash")
    expect(script).toContain("complete -o bashdefault -o default -F _opencode_yargs_completions opencode")
    expect(script).toContain("COMP_WORDS")
  })

  test("unknown shell falls back to bash template", () => {
    const script = generateCompletionScript("tcsh")
    expect(script).toContain("complete -o bashdefault -o default -F _opencode_yargs_completions opencode")
  })
})

describe("detectShell", () => {
  test("recognizes fish from any path", () => {
    expect(detectShell("/usr/bin/fish")).toBe("fish")
    expect(detectShell("/opt/homebrew/bin/fish")).toBe("fish")
  })

  test("recognizes zsh", () => {
    expect(detectShell("/bin/zsh")).toBe("zsh")
    expect(detectShell("/usr/local/bin/zsh")).toBe("zsh")
  })

  test("defaults to bash", () => {
    expect(detectShell(undefined)).toBe("bash")
    expect(detectShell("/bin/bash")).toBe("bash")
    expect(detectShell("")).toBe("bash")
  })
})
