import { describe, expect, test } from "bun:test"
import { formatSessionTable } from "@/cli/cmd/session"
import { Session } from "@/session/session"

const fullID = "ses_0123456789ABCDEFGHIJKLMNOP"

const info = (overrides: Partial<Session.Info>) =>
  ({
    id: fullID,
    slug: "test",
    projectID: "prj_test",
    directory: "/tmp/opencode",
    title: "hello",
    version: "0.1.0",
    time: { created: 0, updated: 0 },
    ...overrides,
  }) as Session.Info

describe("formatSessionTable", () => {
  test("shows the short session id instead of the full id", () => {
    const output = formatSessionTable([info({})])

    expect(output).toContain(fullID.slice(0, 12))
    expect(output).not.toContain(fullID)
  })

  test("keeps the full id in the JSON format", async () => {
    const { formatSessionJSON } = await import("@/cli/cmd/session")
    expect(formatSessionJSON([info({})])).toContain(fullID)
  })
})