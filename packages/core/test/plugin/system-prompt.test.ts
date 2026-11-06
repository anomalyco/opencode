import { describe, expect, test } from "bun:test"
import PROMPT_META from "../../src/plugin/system-prompt/meta.txt"
import PROMPT_KIMI from "../../src/plugin/system-prompt/kimi.txt"
import PROMPT_TRINITY from "../../src/plugin/system-prompt/trinity.txt"
import { SessionSystemPrompt } from "../../src/session/system-prompt"

describe("SystemPromptPlugin", () => {
  test("uses current vocabulary in the Meta prompt", () => {
    expect(PROMPT_META).toContain("`webfetch` returns a message about a redirect")
    expect(PROMPT_META).toContain("`subagent` tool")
    expect(PROMPT_META).not.toContain("Reserve `shell`")
    expect(PROMPT_META).not.toContain("Use `read` on a directory")
    expect(PROMPT_META).not.toContain("dedicated tools")
    expect(PROMPT_META).not.toMatch(
      /TodoWrite|Task tool|WebFetch|\bBash\b|including planning files|https:\/\/opencode\.ai\/docs/,
    )
  })

  test("shell guidance omits dedicated-tool preference", () => {
    const prompt = SessionSystemPrompt.render("base ${OPENCODE_TOOL_GUIDANCE} base", ["shell", "write"])
    expect(prompt).not.toContain("Prefer dedicated tools")
    expect(prompt).toContain("Do not chain shell commands")
  })

  test("kimi and trinity prefer shell for discovery", () => {
    expect(PROMPT_KIMI).not.toContain("by reading it with tools")
    expect(PROMPT_TRINITY).toContain("use the shell tool to list the files")
    expect(PROMPT_TRINITY).toContain("uses shell to find where similar tests are defined")
  })
})
