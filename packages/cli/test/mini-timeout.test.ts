import { expect, test } from "bun:test"
import path from "node:path"
import { isolatedEnv } from "./fixture/environment"
import { tmpdir } from "./fixture/tmpdir"

test("mini waits beyond the fetch idle timeout before and after reconnecting", async () => {
  await using directory = await tmpdir()
  const requests: string[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 0,
    async fetch(request) {
      requests.push(new URL(request.url).pathname)
      // Bun's socket timer sweeps every four seconds, so allow more than two sweeps.
      await Bun.sleep(12_000)
      return new Response(null, { status: 204 })
    },
  })
  const child = Bun.spawn(
    [process.execPath, path.join(import.meta.dir, "fixture/mini-wait.ts"), server.url.toString()],
    {
      cwd: path.join(import.meta.dir, ".."),
      env: isolatedEnv(directory.path, { BUN_CONFIG_HTTP_IDLE_TIMEOUT: "1" }),
      signal: AbortSignal.timeout(25_000),
      stdout: "pipe",
      stderr: "pipe",
    },
  )
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    expect({ stdout, stderr, code }).toEqual({ stdout: "", stderr: "", code: 0 })
    expect(requests.filter((path) => path !== "/api/experimental/session/ses_cancelled/wait").toSorted()).toEqual(
      ["ses_initial", "ses_reconnected", "ses_control"].map((id) => `/api/experimental/session/${id}/wait`).sort(),
    )
  } finally {
    child.kill()
    await child.exited
    await server.stop(true)
  }
}, 30_000)
