import { afterAll, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { setMachOUuid } from "./macho-uuid"

const directory = await mkdtemp(path.join(os.tmpdir(), "macho-uuid-"))

afterAll(() => rm(directory, { recursive: true, force: true }))

// Electron 44.9.1's arm64 main executable, shared by every app on that version.
const STOCK = Buffer.from("4c4c447a55553144a1216e56c3462d63", "hex")

// A thin arm64 executable: the header, an LC_BUILD_VERSION and the LC_UUID.
function executable() {
  const header = Buffer.alloc(32)
  header.writeUInt32LE(0xfeedfacf, 0)
  header.writeUInt32LE(0x0100000c, 4)
  header.writeUInt32LE(2, 12)
  header.writeUInt32LE(2, 16)
  header.writeUInt32LE(48, 20)
  const build = Buffer.alloc(24, 0xab)
  build.writeUInt32LE(0x32, 0)
  build.writeUInt32LE(24, 4)
  const uuid = Buffer.alloc(24)
  uuid.writeUInt32LE(0x1b, 0)
  uuid.writeUInt32LE(24, 4)
  STOCK.copy(uuid, 8)

  return Buffer.concat([header, build, uuid, Buffer.from("code")])
}

async function rewrite(seed: string) {
  const file = path.join(directory, seed.replaceAll(" ", "_"))
  await writeFile(file, executable())
  const uuid = await setMachOUuid(file, seed)

  return { uuid, bytes: await readFile(file) }
}

test("gives each channel, version and architecture its own stable LC_UUID", async () => {
  const seeds = [
    "ai.opencode.desktop 2.4.2 arm64",
    "ai.opencode.desktop 2.4.2 x64",
    "ai.opencode.desktop 2.4.3 arm64",
    "ai.opencode.desktop.beta 2.4.2 arm64",
    "ai.opencode.desktop.dev 2.4.2 arm64",
  ]

  const results = await Promise.all(seeds.map(rewrite))
  const original = executable()

  for (const result of results) {
    expect(result.bytes.subarray(64, 80).toString("hex")).toBe(result.uuid)
    expect(result.uuid).not.toBe(STOCK.toString("hex"))
    // Only the UUID changes.
    expect(Buffer.concat([result.bytes.subarray(0, 64), result.bytes.subarray(80)])).toEqual(
      Buffer.concat([original.subarray(0, 64), original.subarray(80)]),
    )
  }

  expect(new Set(results.map((result) => result.uuid)).size).toBe(seeds.length)
  expect((await rewrite(seeds[0])).uuid).toBe(results[0].uuid)
})

test("refuses a file that is not a thin 64-bit Mach-O", async () => {
  const file = path.join(directory, "universal")
  await writeFile(file, Buffer.concat([Buffer.from("cafebabe00000002", "hex"), Buffer.alloc(64)]))
  await expect(setMachOUuid(file, "seed")).rejects.toThrow("is not a thin 64-bit Mach-O")
})
