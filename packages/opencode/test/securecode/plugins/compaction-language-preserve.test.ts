import { describe, expect, test } from "bun:test"
import {
  CompactionLanguagePreservePlugin,
  LANGUAGE_PROMPT_CONTEXT,
} from "../../../src/securecode/plugins/compaction-language-preserve"

const stubPluginInput = {} as Parameters<typeof CompactionLanguagePreservePlugin>[0]

const baseInput = { sessionID: "ses_test_compaction" }

const baseOutput = (context?: string[]) => ({ context: context ?? [], prompt: undefined })

describe("CompactionLanguagePreservePlugin", () => {
  test("injects language-preservation hint into output.context", async () => {
    const hooks = await CompactionLanguagePreservePlugin(stubPluginInput)
    const hook = hooks["experimental.session.compacting"]!
    const output = baseOutput()
    await hook(baseInput, output)
    expect(output.context).toHaveLength(1)
    expect(output.context[0]).toBe(LANGUAGE_PROMPT_CONTEXT)
  })

  test("appends to existing context entries", async () => {
    const hooks = await CompactionLanguagePreservePlugin(stubPluginInput)
    const hook = hooks["experimental.session.compacting"]!
    const existingContext = ["existing context entry"]
    const output = baseOutput(existingContext)
    await hook(baseInput, output)
    expect(output.context).toHaveLength(2)
    expect(output.context[0]).toBe("existing context entry")
    expect(output.context[1]).toBe(LANGUAGE_PROMPT_CONTEXT)
  })

  test("does not modify prompt field", async () => {
    const hooks = await CompactionLanguagePreservePlugin(stubPluginInput)
    const hook = hooks["experimental.session.compacting"]!
    const output = baseOutput(["context"])
    await hook(baseInput, output)
    expect(output.prompt).toBeUndefined()
  })

  test("no-ops when suppressContext is true", async () => {
    const hooks = await CompactionLanguagePreservePlugin(stubPluginInput, { suppressContext: true })
    const hook = hooks["experimental.session.compacting"]!
    const output = baseOutput()
    await hook(baseInput, output)
    expect(output.context).toHaveLength(0)
  })

  test("context contains language-preservation keywords in Japanese-friendly form", async () => {
    const hooks = await CompactionLanguagePreservePlugin(stubPluginInput)
    const hook = hooks["experimental.session.compacting"]!
    const output = baseOutput()
    await hook(baseInput, output)
    const entry = output.context[0]!
    expect(entry).toContain("same language")
    expect(entry).toContain("most recent conversation")
    expect(entry).toContain("Do not switch to English")
  })
})
