import { describe, expect, test } from "bun:test"
import { providerList } from "../../../../src/cli/cmd/tui/component/provider-list"

describe("providerList", () => {
  test("includes a synthetic Other option for custom providers", () => {
    const list = providerList([{ id: "openai", name: "OpenAI" }])
    expect(list.at(-1)).toEqual({
      title: "Other",
      value: "other",
      description: "Custom provider",
      category: "Providers",
    })
  })

  test("does not use Other as the generic provider group label", () => {
    const list = providerList([{ id: "mistral", name: "Mistral" }])
    expect(list[0]?.category).toBe("Providers")
  })
})
