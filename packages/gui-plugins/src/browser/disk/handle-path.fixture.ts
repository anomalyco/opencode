import { mkdtemp, open, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { setTimeout } from "node:timers/promises"
import electron from "electron"
import { createHandlePath } from "./handle-path"

// The Electron main process of `handle-path.test.ts`, bundled and run by the pinned Electron. It opens, uses and
// closes handle verifiers as plugin instances do across reloads, two of them alive at once, and prints the names they
// gave as one JSON line.

// Reloads measured for a handle leak, and the growth that counts as one: half a handle per reload.
const CYCLES = 200

const LEAK = CYCLES / 2

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

/**
 * The handle count once Electron's own start-up stopped moving it: unchanged for a second. For about half a second
 * after `ready` Chromium opens tens of handles for its threads and child processes (125 measured with other Electron
 * tests running), whatever the fixture does; after that the count holds still. Bounded at 10 seconds, so a process
 * that never settles is still measured.
 */
async function settled() {
  const deadline = Date.now() + 10_000

  const wait = async (count: number | undefined, since: number): Promise<number | undefined> => {
    if (count === undefined || Date.now() - since >= 1_000 || Date.now() >= deadline) return count
    await setTimeout(50)
    const next = await handles()

    return wait(next, next === count ? since : Date.now())
  }

  return wait(await handles(), Date.now())
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

    // Many reloads in a row. On Windows the process's handle count must not grow with them: a verifier that keeps one
    // handle grows it by one per reload. Measured only once the process is quiet, where the same reloads grow it by
    // nothing at all.
    const before = await settled()
    const cycles = []

    for (let index = 0; index < CYCLES; index++) {
      const verifier = createHandlePath()
      cycles.push(await name(verifier))
      await verifier.close()
    }

    const grown = before === undefined ? 0 : ((await handles()) ?? before) - before

    console.log(JSON.stringify({ opened, closed, reopened, overlapping, afterPrevious, cycles: [...new Set(cycles)], leaked: grown >= LEAK }))
  } finally {
    await file.close()
    await rm(dir, { recursive: true, force: true })
    electron.app.exit(0)
  }
})
