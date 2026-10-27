import { describe, expect, test } from "bun:test"
import { keptStages, serviceVersion, shouldRetryEnsure } from "./cli-version"

describe("cli-version", () => {
  test.each([
    { mode: "initial" as const, version: "2.0.32", expected: "2.0.32" },
    { mode: "reconnect" as const, version: "2.0.32", expected: undefined },
  ])("serviceVersion($mode) -> $expected", (input) => {
    expect(serviceVersion(input)).toBe(input.expected)
  })

  test.each([
    { bundled: "0.0.0-dev-2", running: "0.0.0-dev-1", expected: ["0.0.0-dev-2-arm64", "0.0.0-dev-1-arm64"] },
    { bundled: "0.0.0-dev-2", running: "0.0.0-dev-2", expected: ["0.0.0-dev-2-arm64"] },
    { bundled: "2.0.32", running: undefined, expected: ["2.0.32-arm64"] },
  ])("keptStages($bundled, $running)", (input) => {
    expect(keptStages(input.bundled, input.running, "arm64")).toEqual(input.expected)
  })

  test.each([
    { version: undefined, message: "Background service failed to start", expected: true },
    { version: undefined, message: "Timed out waiting for the background service to start", expected: true },
    {
      version: undefined,
      message: "Background service uses an incompatible health protocol. Update this client or explicitly restart the service.",
      expected: false,
    },
    { version: "2.0.32", message: "Background service failed to start", expected: false },
  ])("shouldRetryEnsure($version, $message) -> $expected", (input) => {
    expect(shouldRetryEnsure(input.version, input.message)).toBe(input.expected)
  })
})
