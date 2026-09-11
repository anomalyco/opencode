import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { waitForExit } from "./fixture/service-timing"

const fixture = join(import.meta.dir, "fixture/service.ts")
const spawnerFixture = join(import.meta.dir, "fixture/spawner.ts")

test("spawned service contender survives spawner process exit and receives env", async () => {
  const directory = await mkdtemp(join(tmpdir(), "opencode-service-survival-"))
  const registration = join(directory, "service.json")
  const customEnv = { OPENCODE_SERVICE_ENV_TEST: "configured-survival" }

  try {
    const spawner = Bun.spawn(
      [
        process.execPath,
        spawnerFixture,
        process.execPath,
        fixture,
        registration,
        "environment",
        JSON.stringify(customEnv),
      ],
      {
        stdout: "ignore",
        stderr: "inherit",
      },
    )

    const spawnerExitCode = await spawner.exited
    expect(spawnerExitCode).toBe(0)

    let registered = false
    for (let attempt = 0; attempt < 600; attempt++) {
      if (await Bun.file(registration).exists()) {
        registered = true
        break
      }
      await Bun.sleep(10)
    }
    expect(registered).toBe(true)

    const info = await Bun.file(registration).json()
    expect(info.url).toBeDefined()
    expect(info.pid).toBeDefined()

    const envContent = await Bun.file(registration + ".environment").text()
    expect(envContent).toBe("configured-survival")

    const response = await fetch(new URL("/api/health", info.url), {
      signal: AbortSignal.timeout(2000),
    })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({ healthy: true, version: "test", pid: info.pid })

    process.kill(info.pid, "SIGTERM")
    await waitForExit(info.pid)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
