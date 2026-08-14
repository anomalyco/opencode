import { afterEach, describe, expect, test } from "vitest"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { decodeTimeline } from "../../src/recording/index.js"

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function timeline(contents: string) {
  const directory = await mkdtemp(join(tmpdir(), "drive-decode-test-"))
  directories.push(directory)
  const path = join(directory, "timeline.jsonl")
  await writeFile(path, contents)
  return path
}

async function read(path: string) {
  const records = []
  for await (const record of decodeTimeline(path)) records.push(record)
  return records
}

describe("decodeTimeline", () => {
  test("streams a canonical timeline with or without a final newline", async () => {
    const path = await timeline(
      '{"type":"header","version":1,"cols":80,"rows":24,"encoding":"base64"}\n' +
        '{"type":"output","at_ms":3,"data":"aGk="}\n' +
        '{"type":"resize","at_ms":4,"cols":100,"rows":30}',
    )
    expect(await read(path)).toEqual([
      { type: "header", version: 1, cols: 80, rows: 24, encoding: "base64" },
      { type: "output", at_ms: 3, data: "aGk=" },
      { type: "resize", at_ms: 4, cols: 100, rows: 30 },
    ])
  })

  test.each([
    ["empty file", ""],
    ["output before header", '{"type":"output","at_ms":0,"data":""}\n'],
    ["extra header field", '{"type":"header","version":1,"cols":2,"rows":1,"encoding":"base64","extra":true}\n'],
    [
      "noncanonical base64",
      '{"type":"header","version":1,"cols":2,"rows":1,"encoding":"base64"}\n' +
        '{"type":"output","at_ms":0,"data":"YQ"}\n',
    ],
    [
      "fractional timestamp",
      '{"type":"header","version":1,"cols":2,"rows":1,"encoding":"base64"}\n' +
        '{"type":"output","at_ms":0.5,"data":""}\n',
    ],
    [
      "decreasing timestamps",
      '{"type":"header","version":1,"cols":2,"rows":1,"encoding":"base64"}\n' +
        '{"type":"output","at_ms":2,"data":""}\n' +
        '{"type":"resize","at_ms":1,"cols":2,"rows":1}\n',
    ],
    [
      "invalid resize size",
      '{"type":"header","version":1,"cols":2,"rows":1,"encoding":"base64"}\n' +
        '{"type":"resize","at_ms":1,"cols":0,"rows":1}\n',
    ],
    ["blank line", '{"type":"header","version":1,"cols":2,"rows":1,"encoding":"base64"}\n\n'],
  ])("rejects %s", async (_name, contents) => {
    await expect(read(await timeline(contents))).rejects.toThrow("Invalid recording timeline")
  })
})
