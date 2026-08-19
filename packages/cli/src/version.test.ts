import { expect, test } from "bun:test"
import { InstallationVersion } from "@opencode-ai/core/installation/version"

import { CLI_RUNTIME_VERSION } from "./version"

test("uses the installation version for the CLI runtime", () => {
  expect(CLI_RUNTIME_VERSION).toBe(InstallationVersion)
})
