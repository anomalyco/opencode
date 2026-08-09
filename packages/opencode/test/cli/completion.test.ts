import { describe, expect, test } from "bun:test"
import {
  generateCompletionScript,
  isCompletionShell,
} from "../../src/cli/completion"

describe("cli.completion", () => {
  test("generates a fish script for `completion fish`", () => {
    const script = generateCompletionScript("fish", "opencode", "opencode")
    expect(script).toContain(
      "complete -f -c opencode -a '(opencode --get-yargs-completions (commandline -o)[2..-1])'",
    )
    expect(script).not.toContain("COMP_WORDS")
  })

  test("generates a zsh script for `completion zsh`", () => {
    const script = generateCompletionScript("zsh", "opencode", "opencode")
    expect(script).toContain("#compdef opencode")
    expect(script).not.toContain("COMP_WORDS")
  })

  test("generates a bash script for `completion bash`", () => {
    const script = generateCompletionScript("bash", "opencode", "opencode")
    expect(script).toContain(
      "complete -o bashdefault -o default -F _opencode_yargs_completions opencode",
    )
  })

  test("recognizes only known shells", () => {
    expect(isCompletionShell("bash")).toBe(true)
    expect(isCompletionShell("zsh")).toBe(true)
    expect(isCompletionShell("fish")).toBe(true)
    expect(isCompletionShell("powershell")).toBe(false)
    expect(isCompletionShell(undefined)).toBe(false)
  })
})
