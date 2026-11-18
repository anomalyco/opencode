// Exercises descendant cleanup, including a process that leaves the host's process group.

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
