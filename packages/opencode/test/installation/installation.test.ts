import { describe, test, expect } from "bun:test"
import { Installation } from "../../src/installation"

describe("Installation", () => {
  describe("VERSION", () => {
    test("is a string", () => {
      expect(typeof Installation.VERSION).toBe("string")
    })

    test("is 'local' when OPENCODE_VERSION global is not defined", () => {
      // In test environment, OPENCODE_VERSION is typically not defined
      // so it falls back to "local"
      if (typeof OPENCODE_VERSION !== "string") {
        expect(Installation.VERSION).toBe("local")
      } else {
        expect(Installation.VERSION).toBe(OPENCODE_VERSION)
      }
    })
  })

  describe("CHANNEL", () => {
    test("is a string", () => {
      expect(typeof Installation.CHANNEL).toBe("string")
    })

    test("is 'local' when OPENCODE_CHANNEL global is not defined", () => {
      if (typeof OPENCODE_CHANNEL !== "string") {
        expect(Installation.CHANNEL).toBe("local")
      } else {
        expect(Installation.CHANNEL).toBe(OPENCODE_CHANNEL)
      }
    })
  })

  describe("isPreview()", () => {
    test("returns a boolean", () => {
      expect(typeof Installation.isPreview()).toBe("boolean")
    })

    test("returns true when CHANNEL is not 'latest'", () => {
      // In test env, CHANNEL is 'local', which is not 'latest'
      if (Installation.CHANNEL !== "latest") {
        expect(Installation.isPreview()).toBe(true)
      }
    })
  })

  describe("isLocal()", () => {
    test("returns a boolean", () => {
      expect(typeof Installation.isLocal()).toBe("boolean")
    })

    test("returns true when CHANNEL is 'local'", () => {
      if (Installation.CHANNEL === "local") {
        expect(Installation.isLocal()).toBe(true)
      } else {
        expect(Installation.isLocal()).toBe(false)
      }
    })
  })

  describe("USER_AGENT", () => {
    test("is a string containing version info", () => {
      expect(typeof Installation.USER_AGENT).toBe("string")
      expect(Installation.USER_AGENT).toContain("opencode/")
    })

    test("contains channel and version", () => {
      expect(Installation.USER_AGENT).toContain(Installation.CHANNEL)
      expect(Installation.USER_AGENT).toContain(Installation.VERSION)
    })

    test("follows format opencode/channel/version/client", () => {
      const parts = Installation.USER_AGENT.split("/")
      expect(parts[0]).toBe("opencode")
      expect(parts.length).toBeGreaterThanOrEqual(4)
    })
  })

  describe("Info schema", () => {
    test("validates correct info object", () => {
      const result = Installation.Info.safeParse({
        version: "1.0.0",
        latest: "1.1.0",
      })
      expect(result.success).toBe(true)
    })

    test("rejects missing version", () => {
      const result = Installation.Info.safeParse({
        latest: "1.1.0",
      })
      expect(result.success).toBe(false)
    })

    test("rejects missing latest", () => {
      const result = Installation.Info.safeParse({
        version: "1.0.0",
      })
      expect(result.success).toBe(false)
    })

    test("rejects non-string version", () => {
      const result = Installation.Info.safeParse({
        version: 100,
        latest: "1.1.0",
      })
      expect(result.success).toBe(false)
    })
  })

  describe("UpgradeFailedError", () => {
    test("can be instantiated with stderr message", () => {
      const error = new Installation.UpgradeFailedError({
        stderr: "something went wrong",
      })
      expect(error).toBeInstanceOf(Error)
      expect(error.data.stderr).toBe("something went wrong")
    })

    test("has correct error name", () => {
      const error = new Installation.UpgradeFailedError({
        stderr: "fail",
      })
      expect(error.name).toBe("UpgradeFailedError")
    })
  })

  describe("Event definitions", () => {
    test("Updated event has correct type", () => {
      expect(Installation.Event.Updated.type).toBe("installation.updated")
    })

    test("UpdateAvailable event has correct type", () => {
      expect(Installation.Event.UpdateAvailable.type).toBe(
        "installation.update-available",
      )
    })

    test("Updated event validates version property", () => {
      const result = Installation.Event.Updated.properties.safeParse({
        version: "2.0.0",
      })
      expect(result.success).toBe(true)
    })

    test("UpdateAvailable event rejects missing version", () => {
      const result =
        Installation.Event.UpdateAvailable.properties.safeParse({})
      expect(result.success).toBe(false)
    })
  })
})
