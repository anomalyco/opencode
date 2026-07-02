import { expect, test } from "bun:test"
import type { V2SessionLogData } from "../src/v2/gen/types.gen"

test("uses numeric Session log positions", () => {
  const input = {
    path: { sessionID: "ses_test" },
    query: { after: 1, follow: "false" },
    url: "/api/session/{sessionID}/log",
  } satisfies V2SessionLogData

  expect(input.query.after).toBe(1)
})
