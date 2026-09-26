import { expect, test } from "bun:test"
import { createPluginContext, type Registry, type usePluginHost } from "../src/plugin/api"
import { emptyPrompt } from "../src/prompt/history"
import type { PromptRef } from "../src/component/prompt"

type Ref = Pick<PromptRef, "current" | "append" | "focus">

// Eagerly read host services need a shape; the prompt API only forwards to the ref.
function setup(ref?: Ref) {
  const host = {
    app: {},
    client: {},
    keymap: {},
    shortcuts: {},
    keymapState: {},
    sessionTabs: {},
    prompt: { current: ref },
  } as unknown as ReturnType<typeof usePluginHost>
  const registry: Registry = { has: () => false, set() {}, remove() {}, active: () => true }
  return createPluginContext({ host, id: "test", options: undefined, owned: [], registry }).ui.prompt
}

test("prompt API reads, appends to, and focuses the mounted composer", () => {
  const appended: string[] = []
  let focused = 0
  const prompt = setup({
    current: { ...emptyPrompt(), text: "draft" },
    append(text) {
      appended.push(text)
      return true
    },
    focus() {
      focused++
    },
  })

  expect(prompt.current()).toBe("draft")
  expect(prompt.append(" more")).toBe(true)
  prompt.focus()
  expect(appended).toEqual([" more"])
  expect(focused).toBe(1)
})

test("prompt API reports an unavailable composer and makes focus a no-op", () => {
  const prompt = setup()

  expect(prompt.current()).toBeUndefined()
  expect(prompt.append("text")).toBe(false)
  prompt.focus()
})
