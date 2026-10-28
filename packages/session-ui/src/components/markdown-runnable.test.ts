import { describe, expect, test } from "bun:test"
import { isRunnableCode } from "./markdown-runnable"

describe("isRunnableCode", () => {
  test.each(["bash", "sh", "shell", "zsh", "fish", "BASH", "Sh"])("%s gets a run button", (language) => {
    expect(isRunnableCode(language)).toBe(true)
  })

  // `console`/`terminal` are styled like a shell block but usually show output, not a runnable command.
  test.each(["console", "terminal", "ts", "tsx", "json", "python", "", undefined])(
    "%s gets no run button",
    (language) => {
      expect(isRunnableCode(language)).toBe(false)
    },
  )
})
