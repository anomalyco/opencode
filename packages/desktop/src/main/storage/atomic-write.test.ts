import { describe, expect, test } from "bun:test"
import { dlopen, FFIType, ptr } from "bun:ffi"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { writeFileAtomic } from "./atomic-write"

const dir = () => mkdtempSync(path.join(tmpdir(), "opencode-atomic-write-"))

const writes = [
  { name: "a new file", existing: undefined },
  { name: "an existing file", existing: '{"windowIds":["a"]}' },
]

describe("writeFileAtomic", () => {
  for (const item of writes) {
    test(`writes ${item.name}, creating its directory, without leaving a temporary behind`, () => {
      const file = path.join(dir(), "nested", "opencode.settings")

      if (item.existing !== undefined) {
        mkdirSync(path.dirname(file), { recursive: true })
        writeFileSync(file, item.existing)
      }

      writeFileAtomic(file, '{"pinchZoomEnabled":true}')

      expect(readFileSync(file, "utf8")).toBe('{"pinchZoomEnabled":true}')
      expect(existsSync(`${file}.tmp`)).toBe(false)
    })
  }

  // A write that cannot land must still clean up after itself, so a reader never mistakes a
  // staging file for state.
  test("removes the temporary file when the target cannot be replaced", () => {
    const target = path.join(dir(), "blocked")
    mkdirSync(target)

    expect(() => writeFileAtomic(target, "{}")).toThrow()
    expect(existsSync(`${target}.tmp`)).toBe(false)
  })
})

// The failure this module fixes only exists on Windows, and node:fs cannot produce it: every handle
// it opens grants FILE_SHARE_READ|WRITE|DELETE, so two node:fs handles never contend and a rename
// always wins. Asking for a specific dwShareMode needs Win32, and bun:ffi is the only way to reach
// it without a native build or a test-only seam in the module under test.
function holdOpen(file: string, mode: "read+write" | "exclusive") {
  const GENERIC_READ = 0x80000000
  const FILE_SHARE_READ = 0x00000001
  const FILE_SHARE_WRITE = 0x00000002
  const OPEN_EXISTING = 3
  const share = mode === "read+write" ? FILE_SHARE_READ | FILE_SHARE_WRITE : 0

  const kernel32 = dlopen("kernel32.dll", {
    CreateFileW: {
      args: [FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr, FFIType.u32, FFIType.u32, FFIType.ptr],
      returns: FFIType.ptr,
    },
    CloseHandle: { args: [FFIType.ptr], returns: FFIType.i32 },
  })

  const wide = Buffer.from(`${file}\0`, "utf16le")
  const handle = kernel32.symbols.CreateFileW(ptr(wide), GENERIC_READ, share, null, OPEN_EXISTING, 0, null)

  if (handle === null) throw new Error(`could not open a handle on ${file}`)

  return { handle, release: () => kernel32.symbols.CloseHandle(handle) }
}

const windowsTest = test.skipIf(process.platform !== "win32")

// An antivirus scanner or search indexer reading the file under AppData\Roaming is what produced
// the reported EPERM: it grants FILE_SHARE_WRITE, which permits writing through the open handle but
// not replacing the file.
windowsTest("writes while another handle holds the target open with FILE_SHARE_READ|FILE_SHARE_WRITE", () => {
  const file = path.join(dir(), "opencode.settings")
  writeFileSync(file, '{"ready":false}')
  const holder = holdOpen(file, "read+write")

  try {
    writeFileAtomic(file, '{"ready":true}')
  } finally {
    holder.release()
  }

  expect(readFileSync(file, "utf8")).toBe('{"ready":true}')
  expect(existsSync(`${file}.tmp`)).toBe(false)
})

// A holder that shares nothing blocks the replacement and the write-through alike, so the write has
// to fail loudly. What it must not do is leave the staging file behind or damage the old contents.
windowsTest("reports the lock and keeps the old contents when nothing can be written", () => {
  const file = path.join(dir(), "opencode.settings")
  writeFileSync(file, '{"ready":false}')
  const holder = holdOpen(file, "exclusive")

  try {
    expect(() => writeFileAtomic(file, '{"ready":true}')).toThrow()
  } finally {
    holder.release()
  }

  expect(readFileSync(file, "utf8")).toBe('{"ready":false}')
  expect(existsSync(`${file}.tmp`)).toBe(false)
})
