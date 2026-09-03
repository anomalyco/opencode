import { expect, test } from "bun:test"

import { resolveCliSource } from "./utils"

test("uses the configured local CLI path", () => {
  expect(resolveCliSource({ OPENCODE_DESKTOP_CLI_PATH: "/tmp/opencode-cli" })).toEqual({
    type: "local",
    path: "/tmp/opencode-cli",
  })
})

test("uses the remote CLI when no local path is configured", () => {
  expect(resolveCliSource({})).toEqual({ type: "remote" })
})
