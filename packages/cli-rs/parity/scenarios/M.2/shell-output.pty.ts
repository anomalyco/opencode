// `session.shell` answers before its `session.shell.ended` event arrives: the shell turn stays running for up to
// 1.5 s until the event ends it, then goes idle.
import type { Logged } from "../../lib/fake-server"
import { definePty } from "../../pty/run"
import { leave, opened, server } from "./fixture"

const base = server()

const shell = (entry: Logged, status: string) => {
  const body = entry.body as { id: string; command: string }
  return {
    id: "sh_mini1",
    status,
    command: body.command,
    cwd: "/tmp/mini",
    shell: "/bin/sh",
    file: "/tmp/sh_mini1",
    metadata: {},
    time: { started: 100, ...(status === "running" ? {} : { completed: 101 }) },
    ...(status === "running" ? {} : { exit: 0 }),
  }
}

const durable = (seq: number) => ({ aggregateID: "ses_mini", seq, version: 1 })

export default definePty({
  args: ["mini", "-s", "ses_mini"],
  cols: 60,
  rows: 20,
  server: {
    ...base,
    routes: [
      {
        method: "POST",
        path: "/api/session/ses_mini/shell",
        status: 204,
        thenDelay: 900,
        then: (entry: Logged) => [
          {
            id: (entry.body as { id: string }).id.replace(/^msg_/, "evt_"),
            created: 100,
            type: "session.shell.started",
            durable: durable(90),
            data: { sessionID: "ses_mini", shell: shell(entry, "running") },
          },
          {
            id: "evt_shellended0001",
            created: 101,
            type: "session.shell.ended",
            durable: durable(91),
            data: {
              sessionID: "ses_mini",
              shell: shell(entry, "exited"),
              output: { output: "hello from the shell\n", cursor: 21, size: 21, truncated: false },
            },
          },
        ],
      },
      ...(base.routes ?? []),
    ],
  },
  setup: async (root) => {
    await Bun.write(
      `${root}/home/.config/opencode/cli.json`,
      // TS hides `!` shell turns while `tools` is `hide`, the default (`M07-mini-shell-tools.md`).
      JSON.stringify({ animations: false, mini: { splash: "hide", tools: "show" } }),
    )
  },
  steps: [
    opened,
    { keys: "!echo hello", settle: 300 },
    { keys: "\r", settle: 400, checkpoint: "waiting" },
    { until: { screen: /^build · model · demo/m }, settle: 400, checkpoint: "output", scrollback: 4 },
    ...leave,
  ],
  exits: true,
  requests: "writes",
})
