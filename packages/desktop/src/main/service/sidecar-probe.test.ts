import { describe, expect, mock, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const resources = mkdtempSync(path.join(tmpdir(), "opencode-sidecar-probe-"))
Object.defineProperty(process, "resourcesPath", { value: resources, configurable: true })
writeFileSync(path.join(resources, "opencode-cli.version"), "1.0.0\n")

mock.module("electron", () => ({
  app: {
    isPackaged: true,
    getVersion: () => "1.0.0",
  },
}))

mock.module("@opencode/client/service", () => ({
  fallback: () => "service-prod.json",
  Service: {
    discover: () =>
      Promise.resolve({
        url: "http://127.0.0.1:4096",
        auth: { type: "basic", username: "opencode", password: "secret" },
      }),
  },
}))

const { startSidecarProbe, takeSidecarProbe } = await import("./sidecar-probe")

describe("sidecar probe", () => {
  test("consumes its result once for the initial background-service probe", async () => {
    startSidecarProbe()

    expect(await takeSidecarProbe()).toEqual({
      service: {
        url: "http://127.0.0.1:4096",
        auth: { type: "basic", username: "opencode", password: "secret" },
      },
      file: "service-prod.json",
    })
    // A failed CLI preparation must not leave the boot-time result available to a later initial attempt.
    expect(await takeSidecarProbe()).toBeUndefined()
    rmSync(resources, { recursive: true, force: true })
  })
})
