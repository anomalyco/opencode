// A hovered vertical tab scrolls its overflowing title (`createMarquee` in `session-tabs.tsx`): after 600 ms it steps
// a cell every 80 ms through the title and a ` · ` separator, so the title's start comes round after the dot. Leaving
// the tab puts the title back at its start. Mouse reports are SGR motion with no button (`35`), 1-based cells. Only
// the steps are compared: the screens move with the clock.
import { definePty } from "../../pty/run"

const config = JSON.stringify({
  experimental: { "new-designs": true },
  debug: { devtools: false },
  tabs: { layout: "vertical" },
  session: { sidebar: "hide" },
})
const here = { directory: "/tmp/opencode/packages/tui" }
const title = "Trace the flaky marquee across every terminal we ship"

export default definePty({
  args: ["-s", "ses_m"],
  cols: 120,
  rows: 30,
  env: { OPENCODE_CLI_CONFIG_CONTENT: config },
  // The window titles of opening a session are H.3's.
  osc: [],
  server: {
    fallback: "tui",
    routes: [
      {
        path: "/api/session/ses_m",
        json: {
          data: {
            id: "ses_m",
            title,
            projectID: "proj_test",
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: 1, updated: 2 },
            location: here,
          },
        },
      },
      {
        path: "/api/session/ses_m/message",
        json: { data: [{ id: "msg_1", type: "user", text: "Why so slow?", time: { created: 1 } }], cursor: {} },
      },
      { path: "/api/session/ses_m/inbox", json: { data: [] } },
      { method: "POST", path: "/api/session/:sessionID/view", json: {} },
    ],
  },
  steps: [
    { until: { screen: "Why so slow?" }, settle: 500, timeout: 30_000 },
    // Over the tab's title row.
    { keys: "\x1b[<35;8;2M", until: { screen: "· Trace" }, timeout: 10_000 },
    // Over the transcript: the title is back at its start, and stays there.
    { keys: "\x1b[<35;80;15M", until: { gone: "· Trace" }, settle: 1000, absent: "· Trace" },
  ],
})
