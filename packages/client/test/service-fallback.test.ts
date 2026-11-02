import { afterEach, expect, test } from "bun:test"
import { homedir } from "node:os"
import { join } from "node:path"
import { fallback } from "../src/service-probe"

const saved = process.env["XDG_STATE_HOME"]

afterEach(() => {
  if (saved === undefined) delete process.env["XDG_STATE_HOME"]
  else process.env["XDG_STATE_HOME"] = saved
})

test("an unset XDG_STATE_HOME resolves under the home state directory", () => {
  delete process.env["XDG_STATE_HOME"]
  expect(fallback()).toBe(join(homedir(), ".local", "state", "opencode", "service.json"))
})

test("an empty XDG_STATE_HOME resolves like an unset one", () => {
  process.env["XDG_STATE_HOME"] = ""
  expect(fallback()).toBe(join(homedir(), ".local", "state", "opencode", "service.json"))
})

test("an absolute XDG_STATE_HOME is used as the state directory", () => {
  process.env["XDG_STATE_HOME"] = "/tmp/opencode-state"
  expect(fallback()).toBe(join("/tmp/opencode-state", "opencode", "service.json"))
})
