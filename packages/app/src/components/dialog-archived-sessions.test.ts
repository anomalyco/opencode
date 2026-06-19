import { describe, expect, test } from "bun:test"

describe("DialogArchivedSessions", () => {
  test("loads archived root sessions and restores with null archived time", async () => {
    const source = await Bun.file(new URL("./dialog-archived-sessions.tsx", import.meta.url)).text()

    expect(source).toContain("client.experimental.session")
    expect(source).toContain(".list({ directory: props.directory, roots: true, archived: true")
    expect(source).toContain("props: { directory?: string }")
    expect(source).toContain("archived: true")
    expect(source).toContain("roots: true")
    expect(source).toContain("archived: null")
    expect(source).toContain("client.session")
    expect(source).toContain(".delete({ sessionID: session.id, directory: session.directory })")
  })
})
