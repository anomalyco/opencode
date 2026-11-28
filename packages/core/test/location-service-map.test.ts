import { expect, test } from "bun:test"
import { Location } from "@opencode/schema/location"
import { AbsolutePath } from "@opencode/schema/schema"
import { LocationServiceMap } from "../src/location-service-map.js"

test.each(["wsl.localhost", "wsl$"])("normalizes the forward-slash %s location for the host platform", (host) => {
  const directory = AbsolutePath.make(`//${host}/Ubuntu-24.04/project/`)
  const expected = process.platform === "win32" ? `\\\\${host}\\Ubuntu-24.04\\project` : `/${host}/Ubuntu-24.04/project`

  expect(LocationServiceMap.canonical(Location.Ref.make({ directory })).directory).toBe(AbsolutePath.make(expected))
})

test("keeps POSIX locations in POSIX form", () => {
  const directory = AbsolutePath.make("//remote/project/")
  expect(LocationServiceMap.canonical(Location.Ref.make({ directory })).directory).toBe(
    AbsolutePath.make("/remote/project"),
  )
})
