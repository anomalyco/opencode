import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { Context } from "effect"
import * as fs from "fs/promises"
import path from "path"
import { HttpApiApp } from "../../src/server/routes/instance/httpapi/server"
import { FilePaths } from "../../src/server/routes/instance/httpapi/groups/file"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

const context = Context.empty() as Context.Context<unknown>

function request(
  route: string,
  directory: string,
  query: Record<string, string>,
  body: unknown,
) {
  const url = new URL(`http://localhost${route}`)
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value)
  }
  return HttpApiApp.webHandler().handler(
    new Request(url, {
      method: "PUT",
      headers: {
        "x-opencode-directory": directory,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
    context,
  )
}

async function sha256(bytes: Uint8Array): Promise<string> {
  return createHash("sha256").update(bytes).digest("hex")
}

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

describe("file.write HttpApi", () => {
  test("creates a new file and bytes on disk match", async () => {
    await using tmp = await tmpdir({ git: true })

    const res = await request(FilePaths.write, tmp.path, { path: "new.txt" }, { content: "hello world" })

    expect(res.status).toBe(200)
    const body = await res.json() as { written: boolean; sha: string; path: string }
    expect(body.written).toBe(true)
    expect(typeof body.sha).toBe("string")

    const diskBytes = await fs.readFile(path.join(tmp.path, "new.txt"))
    expect(Buffer.from(diskBytes).toString("utf-8")).toBe("hello world")
  })

  test("overwrites an existing file and returns new sha", async () => {
    await using tmp = await tmpdir({ git: true })
    const filePath = path.join(tmp.path, "existing.txt")
    await Bun.write(filePath, "old content")

    const res = await request(FilePaths.write, tmp.path, { path: "existing.txt" }, { content: "new content" })

    expect(res.status).toBe(200)
    const body = await res.json() as { written: boolean; sha: string }
    expect(body.written).toBe(true)
    expect(typeof body.sha).toBe("string")

    const diskBytes = await fs.readFile(filePath)
    expect(Buffer.from(diskBytes).toString("utf-8")).toBe("new content")

    const expectedSha = await sha256(new TextEncoder().encode("new content"))
    expect(body.sha).toBe(expectedSha)
  })

  test("expectedSha mismatch returns conflict and leaves file unchanged", async () => {
    await using tmp = await tmpdir({ git: true })
    const filePath = path.join(tmp.path, "conflict.txt")
    await Bun.write(filePath, "original content")

    const stale = "0000000000000000000000000000000000000000000000000000000000000000"
    const res = await request(
      FilePaths.write,
      tmp.path,
      { path: "conflict.txt" },
      { content: "new content", expectedSha: stale },
    )

    expect(res.status).toBe(200)
    const body = await res.json() as { written: boolean; conflict: boolean }
    expect(body.written).toBe(false)
    expect(body.conflict).toBe(true)

    // File must be unchanged on disk
    const diskContent = await fs.readFile(filePath, "utf-8")
    expect(diskContent).toBe("original content")
  })

  test("expectedSha match writes successfully", async () => {
    await using tmp = await tmpdir({ git: true })
    const filePath = path.join(tmp.path, "match.txt")
    const originalContent = "original"
    await Bun.write(filePath, originalContent)

    const currentBytes = new TextEncoder().encode(originalContent)
    const currentSha = await sha256(currentBytes)

    const res = await request(
      FilePaths.write,
      tmp.path,
      { path: "match.txt" },
      { content: "updated", expectedSha: currentSha },
    )

    expect(res.status).toBe(200)
    const body = await res.json() as { written: boolean; sha: string }
    expect(body.written).toBe(true)

    const diskContent = await fs.readFile(filePath, "utf-8")
    expect(diskContent).toBe("updated")
  })

  test("path escaping the directory is rejected", async () => {
    await using tmp = await tmpdir({ git: true })

    const res = await request(
      FilePaths.write,
      tmp.path,
      { path: "../../etc/passwd" },
      { content: "evil" },
    )

    // Should result in a server error (500 / defect), not 200
    expect(res.status).toBeGreaterThanOrEqual(500)
  })

  test("writing over a binary file is rejected", async () => {
    await using tmp = await tmpdir({ git: true })
    const filePath = path.join(tmp.path, "image.bin")
    // Write some null bytes to make a binary file
    await fs.writeFile(filePath, Buffer.from([0xff, 0xfe, 0x00, 0x01, 0x02, 0x03]))

    const res = await request(FilePaths.write, tmp.path, { path: "image.bin" }, { content: "text" })

    expect(res.status).toBeGreaterThanOrEqual(500)

    // File must be unchanged on disk
    const diskBytes = await fs.readFile(filePath)
    expect(diskBytes).toEqual(Buffer.from([0xff, 0xfe, 0x00, 0x01, 0x02, 0x03]))
  })
})
