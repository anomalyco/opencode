import { expect } from "bun:test"
import { mkdtemp, rename, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { waitForExit } from "./service-timing"

// Windows has no catchable SIGTERM: process.kill ends the target at once with exit code 1, so the
// service's SIGTERM handler (record the signal, unregister a lingering server, exit 0) runs only on POSIX.
export const catchesSigterm = process.platform !== "win32"
export const stopSignal = catchesSigterm ? "SIGTERM" : undefined
export const stoppedExitCode = catchesSigterm ? 0 : 1

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
    async release(pid: number, action: "fail" | "hang" | "ready") {
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
    // The service's parent execs `sleep`, which never reaps it, so SIGKILL leaves a zombie that
    // still answers `kill(pid, 0)`. Terminating the returned parent lets init reap the service.
    spawnUnreaped(mode: string, ...args: string[]) {
      const subprocess = Bun.spawn(["sh", "-c", '"$@" & exec sleep 60', "sh", ...command(mode, ...args)], {
        stdout: "ignore",
        stderr: "inherit",
      })
      processes.push(subprocess)
      return subprocess
    },
    // Service.ensure detaches contenders; track the elected process before asserting.
    track(pid: number) {
      pids.add(pid)
    },
    // The signal the service recorded while shutting down, if its handler ran.
    signal() {
      return Bun.file(registration + ".signal")
        .text()
        .catch(() => undefined)
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

// The service listens on an ephemeral port. Once it stops, any process may reuse that port for an outgoing connection
// (Windows hands them out from 49152 up, and other suites run alongside), so binding it again proves nothing. What the
// tests need is that nothing accepts connections there anymore.
export async function expectNotListening(url: string) {
  const outcome = await fetch(url).then(
    (response) => `listening (${response.status})`,
    () => "no response",
  )
  expect(outcome).toBe("no response")
}
