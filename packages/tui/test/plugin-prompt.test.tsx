import { expect, test } from "bun:test"
import { createPluginContext, type Registry, type usePluginHost } from "../src/plugin/api"
import type { PromptRef } from "../src/component/prompt"

type Host = ReturnType<typeof usePluginHost>

function setup(prompt?: Pick<PromptRef, "current" | "append" | "focus">) {
  const host = {
    app: { version: "test", channel: "test" },
    client: { api: {} },
    keymap: { dispatch() {}, mode: { current: () => "normal", push: () => () => {} } },
    shortcuts: { list: () => [] },
    keymapState: { commands: () => [], pending: () => [], active: () => [] },
    sessionTabs: { enabled: () => false },
    attention: {},
    prompt: { current: prompt },
  } as unknown as Host
  const registry: Registry = { has: () => false, set() {}, remove() {}, active: () => true }
  return createPluginContext({ host, id: "test", options: undefined, owned: [], registry }).ui.prompt
}

test("prompt API reads, appends to, and focuses the mounted composer", () => {
  const appended: string[] = []
  let focused = 0
  const prompt = setup({
    current: { text: "draft", files: [], agents: [], skills: [], pasted: [] },
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
