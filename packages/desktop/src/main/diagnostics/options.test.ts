import { expect, test } from "bun:test"
import { remoteDebuggingPort } from "./options"

const builds = {
  dev: { packaged: false, channel: "dev" },
  stable: { packaged: true, channel: "prod" },
  packagedDev: { packaged: true, channel: "dev" },
}

test.each([
  ["dev", undefined, "9222"],
  ["dev", "9333", "9333"],
  ["dev", "0", "0"],
  ["dev", "", undefined],
  ["dev", "65536", undefined],
  ["dev", "9222junk", undefined],
  ["dev", "127.0.0.1:9222", undefined],
  ["stable", undefined, undefined],
  ["stable", "9333", undefined],
  ["packagedDev", "9333", undefined],
] as const)("%s remote port %s opens %s", (build, value, expected) => {
  expect(remoteDebuggingPort(builds[build], value)).toBe(expected)
})
