import { describe, expect, test } from "bun:test"
import path from "path"
import { Global } from "@Mackery6969/util/global"
import { Logging } from "@Mackery6969/util/observability/logging"

describe("Logging", () => {
  test("uses a local-specific log file for local installs", () => {
    expect(Logging.file(true, "local")).toBe(path.join(Global.Path.log, "opencode-local.log"))
  })

  test("keeps non-local installs on the default log file", () => {
    expect(Logging.file(false, "next")).toBe(path.join(Global.Path.log, "opencode.log"))
  })
})
