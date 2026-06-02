import { describe, expect, test } from "bun:test"

describe("titlebar tabs", () => {
  test("updates enriched tab title when the session title changes", () => {
    const result = Bun.spawnSync({
      cmd: [
        process.execPath,
        "--conditions=browser",
        "--preload",
        "./happydom.ts",
        "-e",
        `
          import { createMemo, createRoot } from "solid-js"
          import { createStore } from "solid-js/store"
          import { createTitlebarTabsEnriched } from "./src/components/titlebar-tabs.ts"

          createRoot((dispose) => {
            const [tabs] = createStore([
              { dir: "/tmp/project", sessionId: "ses_1", href: "/tmp/project/session/ses_1" },
            ])
            const [sessions, setSessions] = createStore([{ id: "ses_1", title: "Session" }])
            const tabsEnriched = createTitlebarTabsEnriched(tabs, (tab) => () =>
              sessions.find((session) => session.id === tab.sessionId),
            )
            const titleFor = (tab) => (typeof tab.title === "function" ? tab.title() : tab.title)
            const titles = createMemo(() => tabsEnriched().map(titleFor))

            if (JSON.stringify(titles()) !== JSON.stringify(["Session"])) {
              throw new Error("expected initial title")
            }
            setSessions(0, "title", "Generated Title")
            if (JSON.stringify(titles()) !== JSON.stringify(["Generated Title"])) {
              throw new Error("expected generated title")
            }

            dispose()
          })
        `,
      ],
      cwd: new URL("../..", import.meta.url).pathname,
      stderr: "pipe",
      stdout: "pipe",
    })

    expect(result.exitCode, result.stderr.toString() || result.stdout.toString()).toBe(0)
  })
})
