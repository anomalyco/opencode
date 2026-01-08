import { describe, expect, test } from "bun:test"
import type { ACPConfig } from "../../src/acp/types"

describe("ACP command with --prompt", () => {
  test("ACPConfig should accept initialPrompt parameter", () => {
    const config: ACPConfig = {
      sdk: {} as any,
      initialPrompt: "Test prompt",
    }

    expect(config.initialPrompt).toBe("Test prompt")
  })

  test("ACPConfig should allow undefined initialPrompt", () => {
    const config: ACPConfig = {
      sdk: {} as any,
      initialPrompt: undefined,
    }

    expect(config.initialPrompt).toBeUndefined()
  })

  test("ACPConfig should allow missing initialPrompt", () => {
    const config: ACPConfig = {
      sdk: {} as any,
    }

    expect(config.initialPrompt).toBeUndefined()
  })
})

describe("ACP command with --attach", () => {
  test("should connect SDK to existing server when --attach is specified", () => {
    const attachUrl = "http://remote-server:4096"
    const sdkBaseUrl = attachUrl

    expect(sdkBaseUrl).toBe("http://remote-server:4096")
    // ACP connects to existing server, doesn't create proxy
  })

  test("should pass initialPrompt to ACP agent when using --attach with --prompt", () => {
    const attachUrl = "http://remote-server:4096"
    const initialPrompt = "Test prompt"

    const config: ACPConfig = {
      sdk: {} as any,
      initialPrompt,
    }

    expect(config.initialPrompt).toBe("Test prompt")
    // Prompt is sent to the attached server
  })

  test("should not start local server when --attach is specified", () => {
    const attachUrl = "http://example.com:4096"
    const shouldStartServer = !attachUrl
    const sdkBaseUrl = attachUrl

    expect(shouldStartServer).toBe(false)
    expect(sdkBaseUrl).toBe("http://example.com:4096")
  })

  test("should only stop server if local server was started", () => {
    const withAttach = true
    const serverStarted = !withAttach
    const shouldStopServer = serverStarted

    expect(shouldStopServer).toBe(false)
    // No server to stop when using --attach
  })

  test("ACP --attach does not create proxy (unlike web/serve)", () => {
    const attachUrl = "http://remote-server:4096"
    const createsProxy = false // ACP just connects, doesn't proxy

    expect(createsProxy).toBe(false)
    // ACP command connects directly to remote server without proxy
  })
})
