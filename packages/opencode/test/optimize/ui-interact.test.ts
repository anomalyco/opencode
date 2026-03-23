import { describe, expect, it } from "bun:test"

import { TuiEvent } from "../../src/cli/cmd/tui/event"
import { SessionID } from "../../src/session/schema"
import PromptOptimizerPlugin from "../../../../.opencode/plugins/prompt-optimizer"

describe("optimize ui interact", () => {
  it("accepts prompt optimize payloads", () => {
    const sessionID = SessionID.make("ses_test")
    const data = TuiEvent.UiInteract.properties.parse({
      id: "optimize-1",
      action: "prompt.optimize",
      context: {
        prompt: "fix this bug",
        sessionID,
      },
    })

    expect(data.action).toBe("prompt.optimize")
    expect(data.context?.sessionID).toBe(sessionID)
  })

  it("rejects invalid session ids", () => {
    expect(() =>
      TuiEvent.UiInteract.properties.parse({
        id: "optimize-1",
        action: "prompt.optimize",
        context: {
          prompt: "fix this bug",
          sessionID: "bad",
        },
      }),
    ).toThrow()
  })

  it("returns optimized content from the sample plugin", async () => {
    const hooks = await PromptOptimizerPlugin({ client: {} } as never)
    const output: {
      values?: Record<string, unknown>
      action?: string
      cancelled?: boolean
    } = {}

    await hooks["tui.ui.interact"]?.(
      {
        id: "optimize-1",
        action: "prompt.optimize",
        context: {
          prompt: "修复这个 bug",
        },
      },
      output,
    )

    expect(output.cancelled).toBeUndefined()
    expect(output.action).toBe("optimized")
    expect(output.values?.original).toBe("修复这个 bug")
    expect(typeof output.values?.optimized).toBe("string")
    expect(output.values?.optimized).toContain("修复这个 bug")
  })
})
