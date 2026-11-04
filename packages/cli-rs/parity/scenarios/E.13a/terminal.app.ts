// The terminal pane on a fake persistent PTY socket (W06, A04): `<leader>t` shows the session's terminal, which
// replays its snapshot and output, claims control at the pane's size, and echoes typed input; `<leader>up` closes the
// pane, `<leader>t` opens it again on a new socket, and a closed socket shows "Terminal disconnected".
import { defineApp, session, user } from "../../lib/app"

const terminal = {
  id: "pty_1",
  title: "Terminal",
  command: "/bin/sh",
  args: [],
  cwd: "/tmp/opencode/packages/tui",
  status: "running",
  pid: 42,
  sessionID: "ses_t",
  foregroundProcess: null,
  size: { cols: 80, rows: 24 },
  output: { head: 0, tail: 27 },
}

const checkpoint = "Welcome to the fake shell\r\n"

export default defineApp({
  config: { experimental: { "new-designs": true } },
  args: { sessionID: "ses_t" },
  routes: [
    { path: "/api/session/ses_t", json: { data: session("ses_t", "Run the tests", { updated: 2 }) } },
    { path: "/api/session/ses_t/message", json: { data: [user("msg_1", "Open a terminal", 1000)], cursor: {} } },
    { path: "/api/session/ses_t/inbox", json: { data: [] } },
    { path: "/api/experimental/session/ses_t/terminal", json: { data: [terminal] } },
    {
      path: "/api/experimental/persistent-pty/pty_1/snapshot",
      json: {
        data: {
          info: terminal,
          text: "Welcome to the fake shell",
          checkpoint: Buffer.from(checkpoint).toString("base64"),
          cursor: { x: 0, y: 1 },
        },
      },
    },
    {
      method: "POST",
      path: "/api/experimental/persistent-pty/pty_1/connect-token",
      json: { data: { ticket: "ticket_1", expires_in: 30 } },
    },
  ],
  pty: { size: { cols: 80, rows: 24 }, checkpoint, replay: "$ " },
  steps: [
    { checkpoint: "session", until: "Open a terminal" },
    { keys: ["ctrl+x", "t"] },
    { checkpoint: "shown", until: "fake shell" },
    { type: "echo hi" },
    { keys: ["enter"] },
    { checkpoint: "typed", until: "echo hi" },
    // Normal red, blue, and magenta, and bright green, which the palette maps to theme colors.
    { pty: { output: "hi\r\n\x1b[31mred \x1b[34mblue \x1b[35mmagenta \x1b[92mgreen\x1b[0m\r\n$ " } },
    { checkpoint: "output" },
    { keys: ["ctrl+x", "up"] },
    { checkpoint: "closed" },
    { keys: ["ctrl+x", "t"] },
    { checkpoint: "reopened", until: "fake shell" },
    { pty: { close: true } },
    { checkpoint: "disconnected", until: "Terminal disconnected" },
  ],
})
