import { describe, expect, it } from "bun:test"
import { NON_INTERACTIVE_ENV, mergeNonInteractiveEnv } from "../src/env"

describe("env", () => {
  describe("NON_INTERACTIVE_ENV", () => {
    it("should contain all required non-interactive variables", () => {
      expect(NON_INTERACTIVE_ENV.CI).toBe("1")
      expect(NON_INTERACTIVE_ENV.npm_config_yes).toBe("true")
      expect(NON_INTERACTIVE_ENV.pnpm_config_yes).toBe("true")
      expect(NON_INTERACTIVE_ENV.GIT_TERMINAL_PROMPT).toBe("0")
      expect(NON_INTERACTIVE_ENV.NONINTERACTIVE).toBe("1")
      expect(NON_INTERACTIVE_ENV.TERM).toBe("dumb")
    })
  })

  describe("mergeNonInteractiveEnv", () => {
    it("should return defaults when no user env provided", () => {
      const result = mergeNonInteractiveEnv()
      expect(result).toEqual(NON_INTERACTIVE_ENV)
    })

    it("should merge user env with defaults", () => {
      const result = mergeNonInteractiveEnv({ CUSTOM_VAR: "value" })
      expect(result.CUSTOM_VAR).toBe("value")
      expect(result.CI).toBe("1")
    })

    it("should give precedence to user env over defaults", () => {
      const result = mergeNonInteractiveEnv({ CI: "0", npm_config_yes: "false" })
      expect(result.CI).toBe("0")
      expect(result.npm_config_yes).toBe("false")
      expect(result.GIT_TERMINAL_PROMPT).toBe("0") // From defaults
    })

    it("should not modify the original defaults", () => {
      const original = { ...NON_INTERACTIVE_ENV }
      mergeNonInteractiveEnv({ CI: "0" })
      expect(NON_INTERACTIVE_ENV.CI).toBe("1")
      expect(NON_INTERACTIVE_ENV).toEqual(original)
    })
  })
})
