import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { OPENCODE_VERSION } from "../src/version"

const info = {
  id: "ses_export_test",
  projectID: "global",
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1, updated: 2 },
  title: "Exported session",
  location: { directory: "/project" },
}

const health = () => Response.json({ healthy: true, version: OPENCODE_VERSION, pid: process.pid })

function run(args: string[], stdin?: string) {
  const child = Bun.spawn([process.execPath, "run", "src/index.ts", ...args], {
    cwd: path.join(import.meta.dir, ".."),
    stdin: stdin === undefined ? undefined : new Blob([stdin]),
    stdout: "pipe",
    stderr: "pipe",
  })
  return Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited])
}

test("export writes the runtime transfer document", async () => {
  const queries: URLSearchParams[] = []
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/api/health") return health()
      if (url.pathname === `/api/session/${info.id}`) return Response.json({ data: info })
      if (url.pathname === `/api/session/${info.id}/export`) {
        queries.push(url.searchParams)
        return Response.json({
          data: {
            info,
            messages: [
              {
                id: "msg_first",
                type: "user",
                text: "[redacted:text:msg_first]",
                time: { created: 1 },
              },
              {
                id: "msg_second",
                type: "user",
                text: "Second",
                time: { created: 2 },
              },
            ],
          },
        })
      }
      return new Response("Not found", { status: 404 })
    },
  })

  try {
    const [stdout, , exitCode] = await run(["export", info.id, "--server", server.url.toString()])
    const exported = JSON.parse(stdout)

    expect(exitCode).toBe(0)
    expect(exported.info).toEqual(info)
    expect(exported.messages.map((message: { id: string }) => message.id)).toEqual(["msg_first", "msg_second"])
    expect(queries).toHaveLength(1)
    expect(exported.messages[0].text).toBe("[redacted:text:msg_first]")
    expect(queries[0].has("sanitize")).toBe(false)
  } finally {
    await server.stop(true)
  }
}, 15_000)

test("import validates a file and sends it to the resolved location", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-import-"))
  const file = path.join(root, "session.json")
  const body = { info, messages: [] }
  await fs.writeFile(file, JSON.stringify(body))
  let imported: unknown
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === "/api/health") return health()
      if (url.pathname === "/api/location") {
        return Response.json({
          directory: root,
          project: { id: "global", directory: root, canonical: root },
        })
      }
      if (url.pathname === "/api/session/import") {
        imported = await request.json()
        return Response.json({ data: { ...info, location: { directory: root } } })
      }
      return new Response("Not found", { status: 404 })
    },
  })

  try {
    const [stdout, , exitCode] = await run([
      "import",
      file,
      "--directory",
      root,
      "--server",
      server.url.toString(),
    ])

    expect(exitCode).toBe(0)
    expect(stdout).toBe(`Imported session: ${info.id}${os.EOL}`)
    expect(imported).toEqual({ ...body, location: { directory: root } })
  } finally {
    await server.stop(true)
    await fs.rm(root, { recursive: true, force: true })
  }
})
