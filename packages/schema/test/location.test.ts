import { expect, test } from "bun:test"
import { Schema } from "effect"
import { Location } from "../src/location.js"

const details = {
  directory: "/project",
  project: { id: "project", directory: "/project" },
  home: "/home/user",
}

test("Location.Details includes the server home directory", () => {
  expect(String(Schema.decodeUnknownSync(Location.Details)(details as unknown).home)).toBe("/home/user")
  expect(() => Schema.decodeUnknownSync(Location.Details)({ ...details, home: undefined } as unknown)).toThrow()
})
