/**
 * Tests for the security indicator displayed in the session header.
 *
 * The indicator is based on the provider's aTLS configuration (presence of
 * policyFile or policy in options) and the message error state.
 * A provider with a valid policy that responds without error → secure.
 * A provider with a policy that errors → insecure.
 * A provider without any policy → no indicator.
 */
import { describe, expect, test } from "bun:test"
import { getAtlsStatus, getSecurityIndicator } from "../../../src/cli/cmd/tui/util/provider"

describe("getAtlsStatus", () => {
  test("provider with policyFile + no error → connected", () => {
    const options = { policyFile: "/path/to/cvm_policy.json", sdk: "@ai-sdk/anthropic" }
    expect(getAtlsStatus(options, false)).toBe("connected")
  })

  test("provider with policy object + no error → connected", () => {
    const options = { policy: { type: "dstack_tdx" }, sdk: "@ai-sdk/anthropic" }
    expect(getAtlsStatus(options, false)).toBe("connected")
  })

  test("provider with policyFile + error → error (attestation or connection failed)", () => {
    const options = { policyFile: "/path/to/cvm_policy.json", sdk: "@ai-sdk/anthropic" }
    expect(getAtlsStatus(options, true)).toBe("error")
  })

  test("provider with policy object + error → error", () => {
    const options = { policy: { type: "dstack_tdx" }, sdk: "@ai-sdk/anthropic" }
    expect(getAtlsStatus(options, true)).toBe("error")
  })

  test("provider without policy → null (not aTLS)", () => {
    const options = { sdk: "@ai-sdk/openai" }
    expect(getAtlsStatus(options, false)).toBeNull()
  })

  test("undefined options → null", () => {
    expect(getAtlsStatus(undefined, false)).toBeNull()
  })
})

describe("getSecurityIndicator", () => {
  test("aTLS connected without error → secure", () => {
    const result = getSecurityIndicator("connected", false)
    expect(result).toEqual({ label: "🔐 Secure Model ", status: "secure" })
  })

  test("aTLS connected with error → insecure", () => {
    const result = getSecurityIndicator("connected", true)
    expect(result).toEqual({ label: "⚠ Insecure ", status: "error" })
  })

  test("aTLS error without message error → insecure", () => {
    const result = getSecurityIndicator("error", false)
    expect(result).toEqual({ label: "⚠ Insecure ", status: "error" })
  })

  test("aTLS idle → no indicator (no connection yet)", () => {
    const result = getSecurityIndicator("idle", false)
    expect(result).toEqual({ label: "", status: "none" })
  })

  test("no aTLS (null) → no indicator", () => {
    const result = getSecurityIndicator(null, false)
    expect(result).toEqual({ label: "", status: "none" })
  })
})

describe("end-to-end: provider options → security indicator", () => {
  test("correct policy (policyFile) + successful response → 🔐 Secure Model", () => {
    const options = { policyFile: "/path/to/cvm_policy.json", sdk: "@ai-sdk/anthropic" }
    const atlsStatus = getAtlsStatus(options, false)
    const indicator = getSecurityIndicator(atlsStatus, false)
    expect(indicator).toEqual({ label: "🔐 Secure Model ", status: "secure" })
  })

  test("correct policy (policy object) + successful response → 🔐 Secure Model", () => {
    const options = { policy: { type: "dstack_tdx", expected_bootchain: {} }, sdk: "@ai-sdk/anthropic" }
    const atlsStatus = getAtlsStatus(options, false)
    const indicator = getSecurityIndicator(atlsStatus, false)
    expect(indicator).toEqual({ label: "🔐 Secure Model ", status: "secure" })
  })

  test("policy present + error (failed attestation) → ⚠ Insecure", () => {
    const options = { policyFile: "/path/to/bad_policy.json", sdk: "@ai-sdk/anthropic" }
    const atlsStatus = getAtlsStatus(options, true)
    const indicator = getSecurityIndicator(atlsStatus, true)
    expect(indicator).toEqual({ label: "⚠ Insecure ", status: "error" })
  })

  test("no policy (standard provider) → no indicator", () => {
    const options = { sdk: "@ai-sdk/openai", apiKey: "sk-..." }
    const atlsStatus = getAtlsStatus(options, false)
    const indicator = getSecurityIndicator(atlsStatus, false)
    expect(indicator).toEqual({ label: "", status: "none" })
  })
})
