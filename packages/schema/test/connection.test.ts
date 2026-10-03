import { expect, test } from "bun:test"
import { Schema } from "effect"
import { Connection } from "../src/connection.js"

for (const method of ["key", "oauth"] as const) {
  test(`preserves ${method} connection metadata`, () => {
    const input = { type: "credential", id: "cred_test", label: "Account", method } as const
    const value = Schema.decodeUnknownSync(Connection.Info)(input)
    expect(Schema.encodeSync(Connection.Info)(value)).toEqual(input)
  })
}

test("rejects an unknown credential type", () => {
  expect(() =>
    Schema.decodeUnknownSync(Connection.Info)({
      type: "credential",
      id: "cred_test",
      label: "Account",
      method: "password",
    }),
  ).toThrow()
})
