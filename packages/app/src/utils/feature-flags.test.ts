import { beforeEach, describe, expect, test } from "bun:test"
import { isPromptInputTrayEnabled, readLocalStorageFlag, SHOW_PROMPT_INPUT_TRAY_STORAGE_KEY } from "./feature-flags"

describe("feature flags", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  test("local storage flags are disabled by default", () => {
    expect(readLocalStorageFlag(SHOW_PROMPT_INPUT_TRAY_STORAGE_KEY)).toBe(false)
    expect(isPromptInputTrayEnabled()).toBe(false)
  })

  test("local storage flags accept truthy values", () => {
    localStorage.setItem(SHOW_PROMPT_INPUT_TRAY_STORAGE_KEY, "true")
    expect(isPromptInputTrayEnabled()).toBe(true)

    localStorage.setItem(SHOW_PROMPT_INPUT_TRAY_STORAGE_KEY, "1")
    expect(isPromptInputTrayEnabled()).toBe(true)
  })

  test("local storage flags ignore other values", () => {
    localStorage.setItem(SHOW_PROMPT_INPUT_TRAY_STORAGE_KEY, "false")
    expect(isPromptInputTrayEnabled()).toBe(false)
  })
})
