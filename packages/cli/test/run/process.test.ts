import { expect, test } from "bun:test"
import { closeSync, openSync } from "node:fs"
import { symlink } from "node:fs/promises"
import path from "node:path"
import { isolatedEnv } from "../fixture/environment"
import { tmpdir } from "../fixture/tmpdir"

// A server that admits the prompt and then keeps the Session running until interrupted.
async function serve(directory: string) {
  const requests: { method: string; path: string; body?: unknown }[] = []
  const prompted = Promise.withResolvers<void>()
  const interrupted = Promise.withResolvers<void>()
  const location = { directory, project: { id: "project", directory, canonical: directory } }
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 0,
    async fetch(request) {
      const url = new URL(request.url)
      const text = await request.text()
      requests.push({ method: request.method, path: url.pathname, body: text ? JSON.parse(text) : undefined })
      if (url.pathname === "/api/info")
        return Response.json({ version: "test", pid: 0, urls: [], paths: { tmp: directory } })
      if (request.method === "GET" && url.pathname === "/api/location") return Response.json(location)
      if (request.method === "POST" && url.pathname === "/api/session")
        return Response.json({
          data: {
            id: "ses_1",
            projectID: "project",
            location: { directory },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            time: { created: 1, updated: 1 },
          },
        })
      if (url.pathname === "/api/event")
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                `data: ${JSON.stringify({ id: "evt_connected", type: "server.connected", data: {} })}\n\n`,
              )
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        )
      if (url.pathname === "/api/session/ses_1/prompt") {
        prompted.resolve()
        const body = JSON.parse(text)
        return Response.json({
          data: { id: body.id, sessionID: "ses_1", type: "user", time: { created: 1 }, payload: {}, delivery: "steer" },
        })
      }
      if (url.pathname === "/api/session/ses_1/interrupt") {
        interrupted.resolve()
        return Response.json({ interrupted: true })
      }
      if (url.pathname.endsWith("/wait")) return interrupted.promise.then(() => new Response(null, { status: 204 }))
      if (request.method === "GET") return Response.json({ data: [] })
      return new Response(null, { status: 404 })
    },
  })
  return { server, requests, prompted: prompted.promise }
}

function spawnRun(
  url: string,
  directory: string,
  message: string[],
  stdin: "pipe" | "ignore" | ReturnType<typeof Bun.file>,
) {
  return Bun.spawn([process.execPath, "run", "src/index.ts", "run", "--server", url, ...message], {
    cwd: path.join(import.meta.dir, "../.."),
    env: isolatedEnv(directory, { PWD: directory }),
    signal: AbortSignal.timeout(25_000),
    killSignal: "SIGKILL",
    stdin,
    stdout: "pipe",
    stderr: "pipe",
  })
}

test("run sends the message as typed with regular file attachments", async () => {
  await using directory = await tmpdir()
  const file = path.join(directory.path, "context.txt")
  const link = path.join(directory.path, "linked.txt")
  await Bun.write(file, "attached context")
  // Creating symlinks requires privileges on Windows.
  if (process.platform !== "win32") await symlink(file, link)
  const fake = await serve(directory.path)
  const child = spawnRun(
    fake.server.url.toString(),
    directory.path,
    ["--file", file, ...(process.platform === "win32" ? [] : ["--file", link]), "say hello world", `it's "quoted"`],
    "ignore",
  )
  try {
    await fake.prompted
    expect(fake.requests.find((item) => item.path.endsWith("/prompt"))?.body).toMatchObject({
      text:
        `say hello world it's "quoted"\n\n<file name="context.txt">\nattached context\n</file>` +
        (process.platform === "win32" ? "" : `\n\n<file name="linked.txt">\nattached context\n</file>`),
    })
  } finally {
    child.kill("SIGKILL")
    await child.exited
    await fake.server.stop(true)
  }
}, 30_000)

const posix = test.skipIf(process.platform === "win32")

// Windows has no POSIX FIFO filesystem nodes.
posix(
  "run rejects a FIFO attachment without waiting for a writer",
  async () => {
    await using directory = await tmpdir()
    const file = path.join(directory.path, "attachment.txt")
    expect(Bun.spawnSync(["mkfifo", file]).exitCode).toBe(0)
    const fake = await serve(directory.path)
    const child = spawnRun(
      fake.server.url.toString(),
      directory.path,
      ["--file", file, "--format", "json", "hello"],
      "ignore",
    )
    try {
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ])
      expect({ stdout, stderr, exitCode }).toMatchObject({
        stdout: expect.stringContaining("Cannot attach a directory, special file, or file larger than 10 MiB"),
        exitCode: 1,
      })
      expect(fake.requests.some((item) => item.path === "/api/session")).toBe(false)
    } finally {
      child.kill("SIGKILL")
      await child.exited
      await fake.server.stop(true)
    }
  },
  30_000,
)

// Windows has no SIGTERM delivery: kill() terminates the process outright.
posix(
  "run does not wait on spawn's open stdin, and SIGTERM interrupts the Session with 143",
  async () => {
    await using directory = await tmpdir()
    const fake = await serve(directory.path)
    // A stdin pipe that stays open and silent, as with spawn's default stdio.
    const child = spawnRun(fake.server.url.toString(), directory.path, ["hello"], "pipe")
    try {
      await fake.prompted
      await Bun.sleep(200)
      child.kill("SIGTERM")
      expect(await child.exited).toBe(143)
      expect(fake.requests.some((item) => item.path === "/api/session/ses_1/interrupt")).toBe(true)
    } finally {
      child.kill("SIGKILL")
      await child.exited
      await fake.server.stop(true)
    }
  },
  30_000,
)

async function readUntil(stream: ReadableStream<Uint8Array>, marker: string) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let output = ""
  while (!output.includes(marker)) {
    const next = await reader.read()
    if (next.done) break
    output += decoder.decode(next.value, { stream: true })
  }
  const rest = async () => {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      output += decoder.decode(next.value, { stream: true })
    }
    return output + decoder.decode()
  }
  return { rest }
}

// Windows has no SIGTERM/SIGINT signal delivery or POSIX FIFOs.
posix(
  "run cancels an open stdin read on SIGTERM and SIGINT without hitting the shutdown deadline",
  async () => {
    await using directory = await tmpdir()
    const fifo = path.join(directory.path, "stdin.fifo")
    expect(Bun.spawnSync(["mkfifo", fifo]).exitCode).toBe(0)
    const writer = openSync(fifo, "r+")
    const fake = await serve(directory.path)
    const pipeChild = spawnRun(fake.server.url.toString(), directory.path, [], "pipe")
    const fifoChild = spawnRun(fake.server.url.toString(), directory.path, ["hello"], Bun.file(fifo))
    try {
      const cancel = async (child: typeof pipeChild, signal: "SIGTERM" | "SIGINT") => {
        const stderr = await readUntil(child.stderr, "Continuing anyway.")
        child.kill(signal)
        const [out, err, exitCode] = await Promise.all([new Response(child.stdout).text(), stderr.rest(), child.exited])
        return { out, err, exitCode }
      }
      const [pipeResult, fifoResult] = await Promise.all([cancel(pipeChild, "SIGTERM"), cancel(fifoChild, "SIGINT")])
      expect(pipeResult.err).not.toContain("shutdown did not finish")
      expect(pipeResult.out).toBe("")
      expect(pipeResult.exitCode).toBe(143)
      expect(fifoResult.err).not.toContain("shutdown did not finish")
      expect(fifoResult.out).toBe("")
      expect(fifoResult.exitCode).toBe(130)
      expect(fake.requests.some((item) => item.path === "/api/session")).toBe(false)
    } finally {
      pipeChild.kill("SIGKILL")
      fifoChild.kill("SIGKILL")
      await Promise.all([pipeChild.exited, fifoChild.exited])
      closeSync(writer)
      await fake.server.stop(true)
    }
  },
  30_000,
)

posix(
  "run reads a slow shell pipe in full alongside a message argument",
  async () => {
    await using directory = await tmpdir()
    const fake = await serve(directory.path)
    const command = `(sleep 4; echo slow context) | "${process.execPath}" run src/index.ts run --server ${fake.server.url} review`
    const child = Bun.spawn(["sh", "-c", command], {
      cwd: path.join(import.meta.dir, "../.."),
      env: isolatedEnv(directory.path, { PWD: directory.path }),
      signal: AbortSignal.timeout(25_000),
      stdout: "pipe",
      stderr: "pipe",
    })
    try {
      await fake.prompted
      expect(fake.requests.find((item) => item.path.endsWith("/prompt"))?.body).toMatchObject({
        text: "review\nslow context\n",
      })
    } finally {
      child.kill("SIGKILL")
      await child.exited
      await fake.server.stop(true)
    }
  },
  30_000,
)
