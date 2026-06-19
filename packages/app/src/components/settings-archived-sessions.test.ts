import { describe, expect, test } from "bun:test"

describe("settings archived sessions entry", () => {
  test("opens archived session management from both settings designs", async () => {
    const classic = await Bun.file(new URL("./settings-general.tsx", import.meta.url)).text()
    const v2 = await Bun.file(new URL("./settings-v2/general.tsx", import.meta.url)).text()

    for (const source of [classic, v2]) {
      expect(source).toContain('data-action="settings-archived-sessions"')
      expect(source).toContain('language.t("settings.general.row.archivedSessions.title")')
      expect(source).toContain("<module.DialogArchivedSessions />")
    }
  })
})
