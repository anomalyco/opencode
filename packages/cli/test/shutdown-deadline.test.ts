import { expect, test } from "bun:test"
import path from "node:path"

// Windows cannot catch SIGTERM: the process ends at once, so there is no teardown to bound.
const posix = test.skipIf(process.platform === "win32")

posix("exits when teardown outlives the deadline and names what is pending", async () => {
  await hang(200, async (proc, pid) => {
    proc.kill("SIGTERM")
    const stderr = await new Response(proc.stderr).text()
    expect(stderr).toContain("shutdown did not finish within 200ms")
    expect(stderr).toContain("layer test/Hung releasing")
    expect(stderr).toContain(`child ${pid} running: ${process.execPath} -e setInterval`)
    expect(await proc.exited).toBe(1)
  })
})

posix("a second signal during teardown reports and exits without waiting for the deadline", async () => {
  await hang(60_000, async (proc, pid) => {
    const start = Date.now()
    proc.kill("SIGTERM")
    await Bun.sleep(200)
    proc.kill("SIGINT")
    const stderr = await new Response(proc.stderr).text()
    expect(stderr).toContain("received SIGINT again during shutdown")
    expect(stderr).toContain("layer test/Hung releasing")
    expect(stderr).toContain(`child ${pid} running:`)
    expect(await proc.exited).toBe(1)
    expect(Date.now() - start).toBeLessThan(10_000)
  })
})

async function hang(
  deadline: number,
  body: (proc: Bun.Subprocess<"ignore", "pipe", "pipe">, pid: number) => Promise<void>,
) {
  const proc = Bun.spawn([process.execPath, path.join(import.meta.dir, "fixture/shutdown-hang.ts"), String(deadline)], {
    cwd: path.join(import.meta.dir, ".."),
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  })
  const pid = Number((await readLine(proc.stdout, "SHUTDOWN_READY "))?.split(" ")[1])
  try {
    expect(pid).toBeGreaterThan(0)
    await body(proc, pid)
  } finally {
    proc.kill("SIGKILL")
    if (running(pid)) process.kill(pid, "SIGKILL")
  }
}

async function readLine(stream: ReadableStream<Uint8Array>, prefix: string) {
  const decoder = new TextDecoder()
  const chunks: string[] = []
  for await (const chunk of stream) {
    chunks.push(decoder.decode(chunk, { stream: true }))
    const line = chunks
      .join("")
      .split("\n")
      .find((line) => line.startsWith(prefix))
    if (line) return line
  }
}

function running(pid: number) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
