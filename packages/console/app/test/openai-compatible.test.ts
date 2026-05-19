import { describe, expect, test } from "bun:test"
import { createBodyConverter } from "../src/routes/zen/util/provider/provider"
import { oaCompatHelper } from "../src/routes/zen/util/provider/openai-compatible"

describe("oa-compatible provider requests", () => {
  test("strips non-standard reasoning fields from assistant history on same-format requests", () => {
    const converted = createBodyConverter("oa-compat", "oa-compat")({
      model: "kimi-k2.6",
      messages: [
        { role: "user", content: "hello" },
        {
          role: "assistant",
          content: "hi",
          reasoning: "thinking text that some clients preserve",
        },
      ],
      stream: false,
    })

    const outgoing = oaCompatHelper({ reqModel: "kimi-k2.6", providerModel: "kimi-k2.6" }).modifyBody(converted)

    expect(outgoing.messages[1]).toEqual({ role: "assistant", content: "hi" })
  })
})
