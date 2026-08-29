import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { waitForExit } from "./service-timing"

export async function serviceFixture() {
  const directory = await mkdtemp(join(tmpdir(), "opencode-client-service-"))
  const registration = join(directory, "service.json")
  const processes: Bun.Subprocess[] = []
  const pids = new Set<number>()
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
