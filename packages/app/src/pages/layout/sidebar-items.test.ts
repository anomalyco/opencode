import { describe, expect, test } from "bun:test"

describe("SessionItem sidebar actions", () => {
  test("renders a rename action next to archive", async () => {
    const source = await Bun.file(new URL("./sidebar-items.tsx", import.meta.url)).text()

    expect(source).toContain("renameSession: (session: Session) => void")
    expect(source).toContain('aria-label={language.t("common.rename")}')
    expect(source).toContain("props.renameSession(props.session)")
  })
})
