import { beforeEach, describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createClientEnv } from "./client-env"

const STRING_TRUE = "true"

const keys = [
  "VITE_PRODUCTION_LAYOUT",
  "VITE_DISABLE_PROMPT_FOOTER",
  "VITE_DISABLE_PROMPT_PERMISSIONS",
  "VITE_DISABLE_PROMPT_TRIGGERS",
  "VITE_DISABLE_WYSIWYG_ONLY",
  "VITE_DISABLE_CHAT_INTRO",
]

function put(key: string, value?: string) {
  if (value === undefined) {
    Reflect.deleteProperty(import.meta.env, key)
    return
  }
  Reflect.set(import.meta.env, key, value)
}

beforeEach(() => {
  localStorage.clear()
  keys.forEach((key) => put(key))
})

describe("client env", () => {
  test("disables client flags when env flags are not set", () => {
    createRoot((dispose) => {
      const env = createClientEnv()

      expect(env.devMode()).toBe(false)
      expect(env.productionLayout()).toBe(false)
      expect(env.disablePromptFooter()).toBe(false)
      expect(env.disablePromptPermissions()).toBe(false)
      expect(env.disablePromptTriggers()).toBe(false)
      expect(env.disableWysiwygOnly()).toBe(false)
      expect(env.disableChatIntro()).toBe(false)
      expect(localStorage.getItem("devMode")).toBeNull()

      dispose()
    })
  })

  test("enables client flags from env flags", () => {
    keys.forEach((key) => put(key, STRING_TRUE))

    createRoot((dispose) => {
      const env = createClientEnv()

      expect(env.devMode()).toBe(false)
      expect(env.productionLayout()).toBe(true)
      expect(env.disablePromptFooter()).toBe(true)
      expect(env.disablePromptPermissions()).toBe(true)
      expect(env.disablePromptTriggers()).toBe(true)
      expect(env.disableWysiwygOnly()).toBe(true)
      expect(env.disableChatIntro()).toBe(true)

      dispose()
    })
  })

  test("dev mode disables production client flags", () => {
    keys.forEach((key) => put(key, STRING_TRUE))
    localStorage.setItem("devMode", STRING_TRUE)

    createRoot((dispose) => {
      const env = createClientEnv()

      expect(env.devMode()).toBe(true)
      expect(env.productionLayout()).toBe(false)
      expect(env.disablePromptFooter()).toBe(false)
      expect(env.disablePromptPermissions()).toBe(false)
      expect(env.disablePromptTriggers()).toBe(false)
      expect(env.disableWysiwygOnly()).toBe(false)
      expect(env.disableChatIntro()).toBe(false)

      dispose()
    })
  })

  test("ignores non true env values", () => {
    keys.forEach((key) => put(key, "false"))

    createRoot((dispose) => {
      const env = createClientEnv()

      expect(env.devMode()).toBe(false)
      expect(env.productionLayout()).toBe(false)
      expect(env.disablePromptFooter()).toBe(false)
      expect(env.disablePromptPermissions()).toBe(false)
      expect(env.disablePromptTriggers()).toBe(false)
      expect(env.disableWysiwygOnly()).toBe(false)
      expect(env.disableChatIntro()).toBe(false)

      dispose()
    })
  })

  test("submit failure close sec defaults to 5", () => {
    put("VITE_SUBMIT_FAILURE_CLOSE_SEC")

    createRoot((dispose) => {
      expect(createClientEnv().submitFailureCloseSec()).toBe(5)
      dispose()
    })
  })

  test("submit failure close sec reads env", () => {
    put("VITE_SUBMIT_FAILURE_CLOSE_SEC", "8")

    createRoot((dispose) => {
      expect(createClientEnv().submitFailureCloseSec()).toBe(8)
      dispose()
    })
  })

  test("submit failure close sec ignores invalid env", () => {
    put("VITE_SUBMIT_FAILURE_CLOSE_SEC", "0")

    createRoot((dispose) => {
      expect(createClientEnv().submitFailureCloseSec()).toBe(5)
      dispose()
    })
  })
})
