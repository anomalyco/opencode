import { afterEach, describe, expect, test } from "bun:test"
import { spawn } from "child_process"
import fs from "fs"
import os from "os"
import path from "path"
import { pathToFileURL } from "url"
import { LSPClient } from "../../src/lsp"
import { LSPServer } from "../../src/lsp"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util"

void Log.init({ print: false })

function captureFile() {
  return path.join(os.tmpdir(), `lsp-capture-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
}

function spawnCapturingServer(capturePath: string) {
  const serverPath = path.join(__dirname, "../fixture/lsp/capturing-lsp-server.js")
  return {
    process: spawn(process.execPath, [serverPath], {
      stdio: "pipe",
      env: { ...process.env, OPENCODE_LSP_CAPTURE_FILE: capturePath },
    }),
  }
}

async function readCapture(p: string, attempts = 40) {
  for (let i = 0; i < attempts; i++) {
    try {
      const raw = fs.readFileSync(p, "utf8")
      if (raw.length > 0) return JSON.parse(raw) as { workspaceFolders?: { name: string; uri: string }[] }
    } catch {}
    await new Promise((r) => setTimeout(r, 25))
  }
  throw new Error(`capture file empty: ${p}`)
}

afterEach(async () => {
  await Instance.disposeAll()
})

describe("LSPClient multi-root initialize", () => {
  test("initialize payload contains the primary root as workspaceFolders[0]", async () => {
    const capture = captureFile()
    const handle = spawnCapturingServer(capture) as any

    const client = await Instance.provide({
      directory: process.cwd(),
      fn: () =>
        LSPClient.create({
          serverID: "fake",
          server: handle as unknown as LSPServer.Handle,
          root: process.cwd(),
          directory: process.cwd(),
        }),
    })

    const params = await readCapture(capture)
    expect(params.workspaceFolders).toBeDefined()
    expect(params.workspaceFolders!.length).toBe(1)
    expect(params.workspaceFolders![0].uri).toBe(pathToFileURL(process.cwd()).href)

    await client.shutdown()
    try {
      fs.unlinkSync(capture)
    } catch {}
  })

  test("initialize payload includes extraRoots alongside the primary root", async () => {
    const capture = captureFile()
    const handle = spawnCapturingServer(capture) as any

    const primary = fs.mkdtempSync(path.join(os.tmpdir(), "lsp-primary-"))
    const secondary = fs.mkdtempSync(path.join(os.tmpdir(), "lsp-secondary-"))

    const client = await Instance.provide({
      directory: primary,
      fn: () =>
        LSPClient.create({
          serverID: "fake",
          server: handle as unknown as LSPServer.Handle,
          root: primary,
          directory: primary,
          extraRoots: [secondary],
        }),
    })

    const params = await readCapture(capture)
    const uris = (params.workspaceFolders ?? []).map((f) => f.uri)
    expect(uris).toContain(pathToFileURL(primary).href)
    expect(uris).toContain(pathToFileURL(secondary).href)
    expect(uris[0]).toBe(pathToFileURL(primary).href)

    await client.shutdown()
    try {
      fs.unlinkSync(capture)
      fs.rmSync(primary, { recursive: true, force: true })
      fs.rmSync(secondary, { recursive: true, force: true })
    } catch {}
  })

  test("extraRoots duplicates are deduplicated", async () => {
    const capture = captureFile()
    const handle = spawnCapturingServer(capture) as any

    const primary = fs.mkdtempSync(path.join(os.tmpdir(), "lsp-dedup-"))

    const client = await Instance.provide({
      directory: primary,
      fn: () =>
        LSPClient.create({
          serverID: "fake",
          server: handle as unknown as LSPServer.Handle,
          root: primary,
          directory: primary,
          extraRoots: [primary, primary],
        }),
    })

    const params = await readCapture(capture)
    expect(params.workspaceFolders!.length).toBe(1)

    await client.shutdown()
    try {
      fs.unlinkSync(capture)
      fs.rmSync(primary, { recursive: true, force: true })
    } catch {}
  })
})
