import { describe, expect, test } from "bun:test"
import { dlopen, FFIType, ptr } from "bun:ffi"
import path from "path"
import { mkdtemp, readdir, readFile, rename, rm, writeFile } from "fs/promises"
import { tmpdir } from "os"
import { readJson, renameWithRetry, writeJsonAtomic, writeJsonAtomicDetached } from "../../src/util/persistence"

const root = () => mkdtemp(path.join(tmpdir(), "opencode-tui-lock-"))

function lockError(code: string) {
  return Object.assign(new Error(`${code}: operation not permitted, rename`), { code })
}

/**
 * A rename seam that fails with each code in `codes`, in order, and then runs `land`. Counts the
 * attempts and the waits the retry asked for, which is what these tests assert instead of sleeping.
 */
function failing(codes: string[], land?: (from: string, to: string) => Promise<void>) {
  const calls = { attempts: 0, waits: [] as number[] }
  return {
    calls,
    rename: async (from: string, to: string) => {
      const code = codes[calls.attempts]
      calls.attempts++
      if (code !== undefined) throw lockError(code)
      await land?.(from, to)
    },
    wait: async (ms: number) => {
      calls.waits.push(ms)
    },
  }
}

async function failure(promise: Promise<void>) {
  return promise.then(
    () => undefined,
    (error: unknown) => error,
  )
}

async function leftovers(directory: string) {
  return (await readdir(directory)).filter((entry) => entry.endsWith(".tmp"))
}

describe("writeJsonAtomic rename retry", () => {
  test("lands the rename on the second attempt after waiting 50ms", async () => {
    const directory = await root()
    try {
      const target = path.join(directory, "session.json")
      const temporary = path.join(directory, "session.json.new")
      await writeFile(target, '{"pinned":["old"]}')
      await writeFile(temporary, '{"pinned":["new"]}')
      const lock = failing(["EPERM"], rename)

      await renameWithRetry(temporary, target, lock)

      expect(lock.calls.attempts).toBe(2)
      expect(lock.calls.waits).toEqual([50])
      expect(await readFile(target, "utf8")).toBe('{"pinned":["new"]}')
      expect(await leftovers(directory)).toEqual([])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("rethrows the last lock error after the first attempt plus 50, 150 and 450ms retries", async () => {
    const directory = await root()
    try {
      const target = path.join(directory, "session.json")
      await writeFile(target, '{"pinned":["old"]}')
      const lock = failing(["EPERM", "EBUSY", "EPERM", "EBUSY"])

      const caught = await failure(writeJsonAtomic(target, { pinned: ["new"] }, lock))

      expect(caught).toBeInstanceOf(Error)
      expect(lock.calls.attempts).toBe(4)
      expect(lock.calls.waits).toEqual([50, 150, 450])
      // Only a rename that succeeded replaces the destination, so the old file is still whole, and
      // the staging file is removed rather than left for a reader to mistake for state.
      expect(await readJson(target)).toEqual({ pinned: ["old"] })
      expect(await leftovers(directory)).toEqual([])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  const other = [
    { name: "EACCES", code: "EACCES" },
    { name: "ENOENT", code: "ENOENT" },
    { name: "no error code", code: "" },
  ]

  for (const item of other) {
    test(`does not retry a rename that failed with ${item.name}`, async () => {
      const directory = await root()
      try {
        const target = path.join(directory, "session.json")
        await writeFile(target, '{"pinned":["old"]}')
        const cause = item.code ? lockError(item.code) : new Error("rename failed")
        const waits: number[] = []
        let attempts = 0

        const caught = await failure(
          writeJsonAtomic(
            target,
            { pinned: ["new"] },
            {
              rename: async () => {
                attempts++
                throw cause
              },
              wait: async (ms: number) => {
                waits.push(ms)
              },
            },
          ),
        )

        expect(caught).toBe(cause)
        expect(attempts).toBe(1)
        expect(waits).toEqual([])
        expect(await readJson(target)).toEqual({ pinned: ["old"] })
        expect(await leftovers(directory)).toEqual([])
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    })
  }

  // The lock this retry exists for only happens on Windows: every handle node:fs opens grants
  // FILE_SHARE_READ|WRITE|DELETE, so two node:fs handles never contend and a rename always wins.
  // Asking for a narrower dwShareMode needs Win32, and bun:ffi reaches it without a native build.
  // A scanner such as antivirus or the search indexer holds a state file with FILE_SHARE_READ|WRITE,
  // which permits writing through the open handle but not replacing the file.
  function holdOpen(file: string) {
    const GENERIC_READ = 0x80000000
    const FILE_SHARE_READ = 0x00000001
    const FILE_SHARE_WRITE = 0x00000002
    const OPEN_EXISTING = 3
    const kernel32 = dlopen("kernel32.dll", {
      CreateFileW: {
        args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr],
        returns: FFIType.ptr,
      },
      CloseHandle: { args: [FFIType.ptr], returns: FFIType.i32 },
    })
    const wide = Buffer.from(`${file}\0`, "utf16le")
    const handle = kernel32.symbols.CreateFileW(
      ptr(wide),
      GENERIC_READ,
      FILE_SHARE_READ | FILE_SHARE_WRITE,
      null,
      OPEN_EXISTING,
      0,
      null,
    )
    if (handle === null) throw new Error(`could not open a handle on ${file}`)
    return { release: () => kernel32.symbols.CloseHandle(handle) }
  }

  const windowsTest = test.skipIf(process.platform !== "win32")

  windowsTest("retries a destination a real Windows handle holds, then reports the lock", async () => {
    const directory = await root()
    const target = path.join(directory, "session.json")
    await writeFile(target, '{"pinned":["old"]}')
    const holder = holdOpen(target)
    const waits: number[] = []

    let caught: unknown
    try {
      caught = await failure(
        writeJsonAtomic(
          target,
          { pinned: ["new"] },
          {
            wait: async (ms: number) => {
              waits.push(ms)
            },
          },
        ),
      )
    } finally {
      holder.release()
    }

    // The real rename is the one under test here, so the lock is whatever Windows reports for it.
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toMatch(/EPERM|EBUSY/)
    expect(waits).toEqual([50, 150, 450])
    expect(await readJson(target)).toEqual({ pinned: ["old"] })
    expect(await leftovers(directory)).toEqual([])
  })

  test("a detached write reports its failure and the returned promise never rejects", async () => {
    const directory = await root()
    try {
      const target = path.join(directory, "session.json")
      await writeFile(target, '{"pinned":["old"]}')
      const cause = lockError("EPERM")
      const reported: unknown[] = []

      const landed = await writeJsonAtomicDetached(
        target,
        { pinned: ["new"] },
        (error) => {
          reported.push(error)
        },
        {
          rename: async () => {
            throw cause
          },
          wait: async () => undefined,
        },
      )

      expect(landed).toBeUndefined()
      expect(reported).toEqual([cause])
      expect(await readJson(target)).toEqual({ pinned: ["old"] })
      expect(await leftovers(directory)).toEqual([])
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
