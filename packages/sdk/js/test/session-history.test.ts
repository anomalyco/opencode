import { expect, test } from "bun:test"
import type { V2SessionHistoryData } from "../src/v2/gen/types.gen"

test("uses numeric Session history positions", () => {
  const input = {
    path: { sessionID: "ses_test" },
    query: { after: 1, limit: 50 },
    url: "/api/session/{sessionID}/history",
  } satisfies V2SessionHistoryData

  expect(input.query.after).toBe(1)
})
