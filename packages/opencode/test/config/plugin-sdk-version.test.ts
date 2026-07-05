import { describe, expect, test } from "bun:test"
import { pluginSdkVersion } from "@/config/plugin-sdk-version"

// `pluginSdkVersion` decides what version spec — if any — gets handed to the
// package manager when bootstrapping `@opencode-ai/plugin` into a config
// directory. It must never forward the dev placeholder `"local"`: that string
// is a valid display value for User-Agent/telemetry but is not a valid npm
// version, and leaking it surfaces as a recurring `NpmInstallFailedError`
// (`@opencode-ai/plugin@local`) on every config-directory scan.

describe("pluginSdkVersion", () => {
  test("returns undefined for a local channel, even with a real version", () => {
    expect(pluginSdkVersion("1.2.3", true)).toBeUndefined()
  })

  test("returns undefined when the version is the dev placeholder `local`", () => {
    expect(pluginSdkVersion("local", false)).toBeUndefined()
  })

  test("returns undefined when the version is empty", () => {
    expect(pluginSdkVersion("", false)).toBeUndefined()
  })

  test("returns undefined when the version is absent", () => {
    expect(pluginSdkVersion(undefined, false)).toBeUndefined()
  })

  test("passes a published version through unchanged", () => {
    expect(pluginSdkVersion("1.2.3", false)).toBe("1.2.3")
  })

  // Regression: the previous inline ternary at the config-dir bootstrap site —
  //   `version: InstallationLocal ? undefined : InstallationVersion`
  // — only guarded on the *channel* (`InstallationLocal`). When the channel
  // resolved to a real value but the build-time `OPENCODE_VERSION` define was
  // absent (so `InstallationVersion === "local"`), the dev placeholder leaked
  // straight through into the npm spec and every scan failed with
  // `@opencode-ai/plugin@local`.
  test("regression: channel is non-local but version defaulted to `local` no longer leaks", () => {
    // Models the desktop case: OPENCODE_VERSION define missing → "local",
    // while OPENCODE_CHANNEL resolved to a real channel (so InstallationLocal is false).
    expect(pluginSdkVersion("local", false)).toBeUndefined()
  })
})
