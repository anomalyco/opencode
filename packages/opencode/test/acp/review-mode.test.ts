import { afterEach, describe, expect, it } from "bun:test"
import { ReviewOverlay } from "@opencode-ai/core/review-overlay"
import { forceEnableForAcp, isActive, reset, setClientWriteTextFileSupported, syncEnabled } from "@/acp/review-mode"

describe("ACPReviewMode", () => {
  afterEach(() => {
    delete process.env.OPENCODE_ACP_REVIEW
    delete process.env.OPENCODE_CLIENT
    reset()
  })

  it("is inactive without flag even when capability is present", () => {
    process.env.OPENCODE_CLIENT = "acp"
    setClientWriteTextFileSupported(true)
    syncEnabled()
    expect(isActive()).toBe(false)
    expect(ReviewOverlay.isEnabled()).toBe(false)
  })

  it("is inactive outside acp client", () => {
    process.env.OPENCODE_ACP_REVIEW = "1"
    process.env.OPENCODE_CLIENT = "cli"
    setClientWriteTextFileSupported(true)
    syncEnabled()
    expect(isActive()).toBe(false)
  })

  it("is inactive when the client lacks writeTextFile capability, even with the env flag", () => {
    process.env.OPENCODE_ACP_REVIEW = "1"
    process.env.OPENCODE_CLIENT = "acp"
    setClientWriteTextFileSupported(false)
    syncEnabled()
    expect(isActive()).toBe(false)
    expect(ReviewOverlay.isEnabled()).toBe(false)
  })

  it("is inactive when forced but the client lacks writeTextFile capability", () => {
    process.env.OPENCODE_CLIENT = "acp"
    forceEnableForAcp()
    setClientWriteTextFileSupported(false)
    expect(isActive()).toBe(false)
    expect(ReviewOverlay.isEnabled()).toBe(false)
  })

  it("is active when flag, client, and capability are set", () => {
    process.env.OPENCODE_ACP_REVIEW = "1"
    process.env.OPENCODE_CLIENT = "acp"
    setClientWriteTextFileSupported(true)
    syncEnabled()
    expect(isActive()).toBe(true)
    expect(ReviewOverlay.isEnabled()).toBe(true)
  })

  it("is active when forced and the client supports writeTextFile, without the env flag", () => {
    process.env.OPENCODE_CLIENT = "acp"
    forceEnableForAcp()
    setClientWriteTextFileSupported(true)
    expect(isActive()).toBe(true)
    expect(ReviewOverlay.isEnabled()).toBe(true)
  })

  it("deactivates when capability is later reported missing", () => {
    process.env.OPENCODE_CLIENT = "acp"
    forceEnableForAcp()
    setClientWriteTextFileSupported(true)
    expect(isActive()).toBe(true)

    setClientWriteTextFileSupported(false)
    expect(isActive()).toBe(false)
    expect(ReviewOverlay.isEnabled()).toBe(false)
  })
})
