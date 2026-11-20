import { mkdtemp, open, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import electron from "electron"
import { createHandlePath } from "./handle-path"

// The Electron main process of `handle-path.test.ts`, bundled and run by the pinned Electron. It opens, uses and
// closes handle verifiers as plugin instances do across reloads, two of them alive at once, and prints the names they
// gave as one JSON line.

// The process's open handle count, on Windows only.
async function handles() {
  if (process.platform !== "win32") return undefined
  const ffi = await import("ffi-rs")
  ffi.open({ library: "handle-count", path: "kernel32.dll" })
  const count = Buffer.alloc(4)
  const current = ffi.load({ library: "handle-count", funcName: "GetCurrentProcess", retType: ffi.DataType.I64, paramsType: [], paramsValue: [] })
  ffi.load({ library: "handle-count", funcName: "GetProcessHandleCount", retType: ffi.DataType.I32, paramsType: [ffi.DataType.I64, ffi.DataType.U8Array], paramsValue: [current, count] })
  ffi.close("handle-count")

  return count.readUInt32LE(0)
}

void electron.app.whenReady().then(async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "handle-path-")))
  const path = join(dir, "page.html")
  await writeFile(path, "page")
  const file = await open(path, "r")

  const name = (verifier: ReturnType<typeof createHandlePath>) =>
    verifier.path(file.fd).then(
      (value) => (value === path ? "named" : String(value)),
      (error: Error) => error.message,
    )

  try {
    const first = createHandlePath()
    const opened = await name(first)
    await first.close()
    const closed = await name(first)
    const second = createHandlePath()
    const reopened = await name(second)
    await second.close()

    // A reload: the next instance starts while the previous one still runs, and the previous one closes first.
    const previous = createHandlePath()
    const next = createHandlePath()
    const overlapping = [await name(previous), await name(next)]
    await previous.close()
    const afterPrevious = await name(next)
    await next.close()

    // Many reloads in a row. On Windows the process's handle count must not grow with them.
    const before = await handles()
    const cycles = []

    for (let index = 0; index < 50; index++) {
      const verifier = createHandlePath()
      cycles.push(await name(verifier))
      await verifier.close()
    }

    const grown = before === undefined ? 0 : (await handles())! - before

    // A 1-handle-per-cycle leak grows by at least 50; tolerate Electron's startup thread handle jitter.
    console.log(JSON.stringify({ opened, closed, reopened, overlapping, afterPrevious, cycles: [...new Set(cycles)], leaked: grown >= 25 }))
  } finally {
    await file.close()
    await rm(dir, { recursive: true, force: true })
    electron.app.exit(0)
  }
})
