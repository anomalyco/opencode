import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { Recorder } from "../lib/recorder"

describe("recording privacy", () => {
  test("checked-in recordings contain no thinking blocks or deltas", () => {
    const directory = path.join(import.meta.dir, "../fixtures/recordings")
    for (const name of readdirSync(directory)) {
      if (!name.endsWith(".jsonl")) continue
      const lines = readFileSync(path.join(directory, name), "utf8").trim().split("\n")
      for (const line of lines) {
        // Compare booleans so failures cannot print the offending content.
        const unchanged = JSON.stringify(Recorder.parse(line)) === JSON.stringify(JSON.parse(line))
        expect(unchanged, name).toBe(true)
      }
    }
  })
})
