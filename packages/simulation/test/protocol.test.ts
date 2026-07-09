import { expect, test } from "bun:test"
import { Frontend } from "../src/protocol"

test("decodes ui.matches text params", () => {
  expect(
    Frontend.decodeRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "ui.matches",
      params: { text: "OpenCode [ready].*" },
    }),
  ).toMatchObject({ method: "ui.matches", params: { text: "OpenCode [ready].*" } })
  expect(() =>
    Frontend.decodeRequest({
      jsonrpc: "2.0",
      id: 1,
      method: "ui.matches",
      params: { pattern: "OpenCode.*" },
    }),
  ).toThrow()
})
