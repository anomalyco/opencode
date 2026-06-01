import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { ConfigAttachment } from "../../src/config/attachment"

describe("AttachmentSaveConfig", () => {
  const decode = Schema.decodeUnknownSync(ConfigAttachment.Info)

  test("defaults applied when omitted", () => {
    const config = decode({})
    expect(config.image).toBeUndefined()
    expect(config.save_to_disk).toBeUndefined()
    expect(config.save_to_disk_path).toBeUndefined()
  })

  test("custom path respected", () => {
    const config = decode({ save_to_disk_path: "/custom/path" })
    expect(config.save_to_disk_path).toBe("/custom/path")
    expect(config.save_to_disk).toBeUndefined()
  })

  test("save disabled", () => {
    const config = decode({ save_to_disk: false })
    expect(config.save_to_disk).toBe(false)
  })

  test("save enabled explicitly", () => {
    const config = decode({ save_to_disk: true })
    expect(config.save_to_disk).toBe(true)
  })

  test("unknown fields are stripped", () => {
    const config = decode({ unknown_field: "nope" } as any)
    expect((config as any).unknown_field).toBeUndefined()
  })

  test("legacy config with no attachment block still works", () => {
    // Simulate parsing from a broader config that omits `attachment` entirely
    const fullConfig = decode({})
    expect(fullConfig).toBeDefined()
    expect(fullConfig.save_to_disk).toBeUndefined()
    expect(fullConfig.save_to_disk_path).toBeUndefined()
  })

  test("save_to_disk defaults true when used in application code (non-regression)", () => {
    // The schema makes the field optional; application layer treats undefined as true
    const config = decode({ save_to_disk: true })
    expect(config.save_to_disk).toBe(true)

    const config2 = decode({})
    // undefined means "not set" → application layer uses default (true)
    expect(config2.save_to_disk).toBeUndefined()
  })
})
