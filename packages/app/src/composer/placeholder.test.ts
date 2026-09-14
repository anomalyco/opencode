import { describe, expect, test } from "bun:test"
import { composerPlaceholder } from "./placeholder"

describe("Composer placeholder", () => {
  const t = (key: string, params?: Record<string, string>) =>
    `${key}${params?.example ? `:${params.example}` : ""}${params?.slash ?? ""}${params?.at ?? ""}`

  test("uses the shell command placeholder in shell mode", () => {
    expect(composerPlaceholder("shell", t)).toBe("prompt.placeholder.shell:git status")
  })

  test("uses the command and context hint in normal mode", () => {
    expect(composerPlaceholder("normal", t)).toBe("ui.promptInput.placeholder.normal/@")
  })

  test("uses the follow-up copy while a turn runs or prompts are queued", () => {
    expect(composerPlaceholder("normal", t, true)).toBe("ui.promptInput.placeholder.followUp/@")
  })

  test("keeps the shell placeholder while a turn runs", () => {
    expect(composerPlaceholder("shell", t, true)).toBe("prompt.placeholder.shell:git status")
  })
})
