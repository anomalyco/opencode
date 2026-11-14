// A plugin that starts processes, for the pipe's tests (review: no orphans): its setup starts `sleep` as a child, and
// another through a shell that exits at once, in a session of its own (it leaves the JS host's process group, and its
// parent is gone). It writes their process IDs to the file its `pids` option names. Its command spins forever.

import { writeFileSync } from "node:fs"

export default {
  id: "example.spawner",
  async setup(api: any) {
    const carrier = api[Symbol.for("opencode.carrier")]
    const child = Bun.spawn(["sleep", "60"])
    const shell = Bun.spawn(["sh", "-c", "setsid sleep 61 >/dev/null 2>&1 </dev/null & echo $!"], { stdout: "pipe" })
    const escaped = (await new Response(shell.stdout).text()).trim()
    await shell.exited
    writeFileSync(api.options.pids, `${child.pid} ${escaped}`)
    carrier.command({ name: "spawner.spin", title: "spawner.spin" }, () => {
      while (true) {}
    })
  },
}
