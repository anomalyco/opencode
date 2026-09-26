import { mkdtemp, rename, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { waitForExit } from "./service-timing"

export async function serviceFixture() {
  const directory = await mkdtemp(join(tmpdir(), "opencode-client-service-"))
  const registration = join(directory, "service.json")
  const processes: Bun.Subprocess[] = []
  const pids = new Set<number>()
  const starts = async () =>
    (
      await Bun.file(registration + ".starts")
        .text()
        .catch(() => "")
    )
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(Number)
  const command = (mode: string, ...args: string[]) => [
    process.execPath,
    join(import.meta.dir, "service.ts"),
    registration,
    mode,
    ...args,
  ]

  return {
    directory,
    registration,
    command,
    starts,
    async waitForStarts(count: number) {
      for (let attempt = 0; attempt < 600; attempt++) {
        const result = await starts()
        if (result.length >= count) return result
        await Bun.sleep(5)
      }
      throw new Error(`Timed out waiting for ${count} contenders`)
    },
    async release(pid: number, action: "fail" | "ready") {
      const file = registration + `.release-${pid}`
      await Bun.write(file + ".tmp", action)
      await rename(file + ".tmp", file)
      if (action === "fail") await waitForExit(pid)
    },
    spawn(mode: string, ...args: string[]) {
      const subprocess = Bun.spawn(command(mode, ...args), { stdout: "ignore", stderr: "inherit" })
      processes.push(subprocess)
      return subprocess
    },
    // Service.ensure detaches contenders; track the elected process before asserting.
    track(pid: number) {
      pids.add(pid)
    },
    async waitForFile(file = registration) {
      for (let attempt = 0; attempt < 600; attempt++) {
        if (await Bun.file(file).exists()) return
        await Bun.sleep(5)
      }
      throw new Error(`Timed out waiting for ${file}`)
    },
    async [Symbol.asyncDispose]() {
      // Include detached contenders that never registered, even when an assertion fails.
      for (const pid of await starts()) pids.add(pid)
      await Promise.all([
        ...processes.map(async (subprocess) => {
          subprocess.kill("SIGTERM")
          await subprocess.exited
        }),
        ...[...pids].map(async (pid) => {
          try {
            process.kill(pid, "SIGTERM")
          } catch (error) {
            if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error
          }
          await waitForExit(pid)
        }),
      ]).finally(() => rm(directory, { recursive: true, force: true }))
    },
  }
}
