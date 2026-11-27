import { expect, test } from "bun:test"
import { LinuxSandbox } from "../src/sandbox/linux"
import { SandboxPolicy } from "../src/sandbox/policy"
import { tmpdir } from "./fixture/tmpdir"
import { nativeSandbox, sandboxHost } from "./fixture/sandbox-host"

const native = test.skipIf(process.platform !== "linux" || !(await nativeSandbox()))

native.each([false, true])(
  "Bubblewrap isolates PID lookup and mounts procfs read-only with fullDiskRead=%s",
  async (fullDiskRead) => {
    await using temporary = await tmpdir()
    const host = await sandboxHost(temporary.path)
    const backend = await LinuxSandbox.backend()
    const policy = await backend.policy(host, { fullDiskRead })
    const run = async (script: string) => {
      const env = SandboxPolicy.environment(process.env, host.scratch)
      const launch = await backend.launch(policy, "/bin/sh", ["-c", script], env)
      return Bun.spawnSync([launch.command, ...launch.args], { cwd: host.directory, env: launch.env, timeout: 10_000 })
    }
    expect((await run(`test ! -e /proc/${process.pid}/cmdline`)).exitCode).toBe(0)
    // A broad read can stack fresh procfs over a host mount. Resolve the
    // effective mount via the descriptor instead of counting hidden layers.
    for (const target of ["/proc", "/proc/sys", "/proc/sys/kernel/core_pattern"]) {
      const mounted = await run(`exec 8<'${target}'; cat /proc/self/fdinfo/8 /proc/self/mountinfo`)
      expect(mounted.exitCode).toBe(0)
      const info = mounted.stdout.toString()
      const id = /^mnt_id:\s*(\d+)$/m.exec(info)?.[1]
      expect(id).toBeDefined()
      const mount = info.split("\n").find((line) => line.startsWith(`${id} `))
      expect({ target, mount, readonly: mount?.split(" ")[5].split(",").includes("ro") }).toMatchObject({
        readonly: true,
      })
    }
  },
)
