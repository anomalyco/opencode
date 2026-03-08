import { spawn } from "child_process"
import { StringDecoder } from "string_decoder"
import { expect, test } from "bun:test"

// Reproduces the bug in src/tool/bash.ts where `output += chunk.toString()`
// corrupts multi-byte UTF-8 characters that get split across data events.
//
// The child process writes raw bytes of "cleanup — end" with the 3-byte
// emdash (U+2014 = 0xE2 0x80 0x94) deliberately split across two writes
// with a flush boundary between them.

function spawnSplitEmdash() {
  return spawn("python3", [
    "-c",
    `
import sys, os
# "cleanup " + first byte of emdash
os.write(1, b"cleanup \\xe2")
# Force kernel to deliver this as a separate read
import time; time.sleep(0.05)
# Remaining 2 bytes of emdash + " end"
os.write(1, b"\\x80\\x94 end")
`,
  ])
}

test("bash.ts stdout assembly corrupts emdash split across chunks", async () => {
  const proc = spawnSplitEmdash()

  // Replicate exactly what bash.ts does: output += chunk.toString()
  let output = ""
  let chunks = 0

  await new Promise<void>((resolve) => {
    proc.stdout!.on("data", (chunk: Buffer) => {
      output += chunk.toString()
      chunks++
    })
    proc.on("close", resolve)
  })

  if (chunks < 2) {
    console.log("SKIP: OS delivered all bytes in one chunk")
    return
  }

  // The bug: chunk.toString() on partial UTF-8 produces replacement chars
  expect(output).toContain("\uFFFD")
  expect(output).not.toContain("—")
})

test("StringDecoder fix prevents emdash corruption", async () => {
  const proc = spawnSplitEmdash()
  const decoder = new StringDecoder("utf8")

  // The fix: use StringDecoder.write() instead of chunk.toString()
  let output = ""
  let chunks = 0

  await new Promise<void>((resolve) => {
    proc.stdout!.on("data", (chunk: Buffer) => {
      output += decoder.write(chunk)
      chunks++
    })
    proc.on("close", () => {
      output += decoder.end()
      resolve()
    })
  })

  if (chunks < 2) {
    console.log("SKIP: OS delivered all bytes in one chunk")
    return
  }

  // StringDecoder buffers incomplete sequences — no corruption
  expect(output).toContain("—")
  expect(output).not.toContain("\uFFFD")
})

test("stdout and stderr need separate decoders", () => {
  const shared = new StringDecoder("utf8")
  const mixed = shared.write(Buffer.from([0xe2, 0x86])) + shared.write(Buffer.from([0x91])) + shared.end()

  const stdout = new StringDecoder("utf8")
  const stderr = new StringDecoder("utf8")
  const separate =
    stdout.write(Buffer.from([0xe2, 0x86])) + stderr.write(Buffer.from([0x91])) + stdout.end() + stderr.end()

  expect(mixed).toBe("↑")
  expect(separate).toBe("��")
})
