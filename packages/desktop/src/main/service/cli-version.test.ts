import { describe, expect, test } from "bun:test"
import path from "node:path"
import { keptStages, releasedBuild, serviceFile, serviceVersion, shouldRetryEnsure } from "./cli-version"

describe("cli-version", () => {
  test.each([
    {
      channel: "beta" as const,
      isolated: false,
      mode: "initial" as const,
      version: "0.0.0-beta-2",
      expected: releasedBuild,
    },
    {
      channel: "beta" as const,
      isolated: true,
      mode: "initial" as const,
      version: "0.0.0-beta-2",
      expected: "0.0.0-beta-2",
    },
    { channel: "prod" as const, isolated: false, mode: "initial" as const, version: "2.0.32", expected: "2.0.32" },
    {
      channel: "dev" as const,
      isolated: false,
      mode: "initial" as const,
      version: "0.0.0-dev-9",
      expected: "0.0.0-dev-9",
    },
    {
      channel: "beta" as const,
      isolated: false,
      mode: "reconnect" as const,
      version: "0.0.0-beta-2",
      expected: undefined,
    },
  ])("serviceVersion($channel, isolated=$isolated, $mode)", (input) => {
    expect(serviceVersion(input)).toBe(input.expected)
  })

  // The beta app keeps whichever released server it finds in the shared registration, older or newer.
  test.each([
    { running: "0.0.0-beta-1", expected: true },
    { running: "0.0.0-beta-3", expected: true },
    { running: "2.0.32", expected: true },
    { running: "0.0.0-next-5", expected: true },
    // A dev build an older dev CLI registered in the shared file is replaced.
    { running: "0.0.0-dev-21146", expected: false },
  ])("releasedBuild($running) -> $expected", (input) => {
    expect(releasedBuild(input.running)).toBe(input.expected)
  })

  // The file follows the CLI, not the app: a source build of the desktop runs whichever CLI it downloaded or built.
  test.each([
    { version: "0.0.0-dev-9", server: undefined, expected: path.join("/state", "opencode", "service-dev.json") },
    { version: "2.0.32", server: undefined, expected: undefined },
    { version: "0.0.0-beta-2", server: undefined, expected: undefined },
    { version: "local", server: "local", expected: path.join("/state", "opencode", "service-local.json") },
  ])("serviceFile($version, server=$server)", (input) => {
    expect(serviceFile({ ...input, stateHome: "/state" })).toBe(input.expected)
  })

  test.each([
    { bundled: "0.0.0-beta-2", running: "0.0.0-beta-1", expected: ["0.0.0-beta-2-arm64", "0.0.0-beta-1-arm64"] },
    { bundled: "0.0.0-beta-2", running: "0.0.0-beta-2", expected: ["0.0.0-beta-2-arm64"] },
    { bundled: "2.0.32", running: undefined, expected: ["2.0.32-arm64"] },
  ])("keptStages($bundled, $running)", (input) => {
    expect(keptStages(input.bundled, input.running, "arm64")).toEqual(input.expected)
  })

  test.each([
    { pinned: false, message: "Background service failed to start", expected: true },
    { pinned: false, message: "Timed out waiting for the background service to start", expected: true },
    {
      version: releasedBuild,
      message:
        "Background service uses an incompatible health protocol. Update this client or explicitly restart the service.",
      expected: false,
    },
    { pinned: true, message: "Background service failed to start", expected: false },
  ])("shouldRetryEnsure($message) -> $expected", (input) => {
    expect(shouldRetryEnsure(input.pinned, input.message)).toBe(input.expected)
  })
})
