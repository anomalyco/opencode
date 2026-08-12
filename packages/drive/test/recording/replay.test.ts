import { afterEach, describe, expect, test } from "vitest"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { replayRecording } from "../../src/recording/index.js"
import { replay } from "../../src/recording/replay.js"

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function recording(events: Array<[number, string]>, cols = 12, rows = 3) {
  const directory = await mkdtemp(join(tmpdir(), "drive-replay-test-"))
  directories.push(directory)
  const path = join(directory, "timeline.jsonl")
  const lines = [
    JSON.stringify({
      type: "header",
      version: 1,
      cols,
      rows,
      encoding: "base64",
    }),
    ...events.map(([at_ms, data]) =>
      JSON.stringify({
        type: "output",
        at_ms,
        data: Buffer.from(data).toString("base64"),
      }),
    ),
  ]
  await writeFile(path, `${lines.join("\n")}\n`)
  return path
}

async function timeline(records: Array<Record<string, unknown>>, cols = 12, rows = 3) {
  const directory = await mkdtemp(join(tmpdir(), "drive-replay-test-"))
  directories.push(directory)
  const path = join(directory, "timeline.jsonl")
  const lines = [
    JSON.stringify({
      type: "header",
      version: 1,
      cols,
      rows,
      encoding: "base64",
    }),
    ...records.map((record) => JSON.stringify(record)),
  ]
  await writeFile(path, `${lines.join("\n")}\n`)
  return path
}

function lineText(frame: Awaited<ReturnType<typeof replayRecording>>[number]["frame"], row = 0) {
  return frame.lines[row]!.spans.map((span) => span.text)
    .join("")
    .trimEnd()
}

describe("replayRecording", () => {
  test("samples at the requested FPS and retains the off-grid final state", async () => {
    const frames = await replayRecording(
      await recording([
        [0, "A"],
        [150, "B"],
        [450, "C"],
      ]),
      { fps: 5 },
    )
    expect(frames.map((frame) => frame.atMs)).toEqual([0, 200, 400, 450])
    expect(frames.map((frame) => lineText(frame.frame))).toEqual(["A", "AB", "AB", "ABC"])
  })

  test("applies all same-time events before taking that sample", async () => {
    const frames = await replayRecording(
      await recording([
        [0, "A"],
        [0, "B"],
      ]),
    )
    expect(frames).toHaveLength(1)
    expect(lineText(frames[0]!.frame)).toBe("AB")
  })

  test("preserves quiet time through the final empty output event", async () => {
    const frames = await replayRecording(
      await recording([
        [0, "ready"],
        [1_000, ""],
      ]),
    )
    expect(frames).toHaveLength(61)
    expect(frames[1]!.atMs).toBeCloseTo(1_000 / 60)
    expect(frames.at(-1)!.atMs).toBe(1_000)
    expect(frames.every((frame) => lineText(frame.frame) === "ready")).toBe(true)
    expect(new Set(frames.map((frame) => frame.frame)).size).toBe(1)
  })

  test("captures terminal state at sample boundaries instead of every event", async () => {
    let snapshots = 0
    let dirty = false
    const frames = await replay(
      await recording(Array.from({ length: 101 }, (_, atMs) => [atMs, "x"])),
      {
        fps: 10,
        terminalFactory: async (cols, rows) => ({
          write: () => {
            dirty = true
          },
          resize: () => {
            dirty = true
          },
          finish: () => false,
          snapshot: () => {
            snapshots++
            return {
              cols,
              rows,
              cursor: { row: 0, col: 0, visible: false },
              lines: Array.from({ length: rows }, (_, row) => ({
                spans: row === 0 && dirty
                  ? [{ text: "ready", width: 5, fg: 0xffffff, bg: 0x080808, attributes: 0 }]
                  : [],
              })),
            }
          },
        }),
      },
    )

    expect(frames.map((frame) => frame.atMs)).toEqual([0, 100])
    expect(snapshots).toBe(2)
  })

  test("trims blank startup time and rebases the first visible frame", async () => {
    const frames = await replayRecording(
      await recording([
        [500, "   "],
        [1_000, "\rready"],
        [1_500, ""],
      ]),
      { fps: 10 },
    )

    expect(frames.map((frame) => frame.atMs)).toEqual([0, 100, 200, 300, 400, 500])
    expect(frames.every((frame) => lineText(frame.frame) === "ready")).toBe(true)
  })

  test("trims to an explicit origin and holds the final frame to a shared duration", async () => {
    const frames = await replayRecording(
      await recording([
        [0, "A"],
        [500, "B"],
        [1_000, "C"],
      ]),
      { fps: 10, startAtMs: 500, durationMs: 1_000 },
    )

    expect(frames[0]!.atMs).toBe(0)
    expect(lineText(frames[0]!.frame)).toBe("AB")
    expect(frames.at(-1)!.atMs).toBe(1_000)
    expect(lineText(frames.at(-1)!.frame)).toBe("ABC")
  })

  test("resizes the terminal during replay", async () => {
    const frames = await replayRecording(
      await timeline(
        [
          {
            type: "output",
            at_ms: 0,
            data: Buffer.from("A").toString("base64"),
          },
          { type: "resize", at_ms: 100, cols: 8, rows: 4 },
          {
            type: "output",
            at_ms: 100,
            data: Buffer.from("B").toString("base64"),
          },
        ],
        4,
        2,
      ),
      { fps: 10 },
    )
    expect(frames.map((frame) => [frame.atMs, frame.frame.cols, frame.frame.rows])).toEqual([
      [0, 4, 2],
      [100, 8, 4],
    ])
    expect(lineText(frames.at(-1)!.frame)).toBe("AB")
  })

  test("does not expose a synchronized update before its closing wrapper", async () => {
    const frames = await replayRecording(
      await recording([
        [0, "old"],
        [100, "\x1b[?2026h\rnew"],
        [400, "\x1b[?2026l"],
      ]),
      { fps: 5 },
    )
    expect(frames.map((frame) => frame.atMs)).toEqual([0, 200, 400])
    expect(frames.map((frame) => lineText(frame.frame))).toEqual(["old", "old", "new"])
  })

  test("tracks output around multiple synchronized updates in one chunk", async () => {
    const frames = await replayRecording(
      await recording([
        [0, "old"],
        [100, "\r\x1b[2Kpre\x1b[?2026h\r\x1b[2Khidden"],
        [300, "\x1b[?2026l\r\x1b[2Kshown\x1b[?2026h\r\x1b[2Khidden2"],
        [500, "\x1b[?2026l"],
      ]),
      { fps: 5 },
    )
    expect(frames.map((frame) => frame.atMs)).toEqual([0, 200, 400, 500])
    expect(frames.map((frame) => lineText(frame.frame))).toEqual(["old", "pre", "shown", "hidden2"])
  })

  test("captures truecolor, styles, cursor, and wide Unicode", async () => {
    const styled = "\x1b[1;2;3;4;5;7;8;9;38;2;1;2;3;48;2;4;5;6m界\x1b[0m\x1b[2;4H"
    const [sample] = await replayRecording(await recording([[0, styled]], 8, 3))
    const span = sample!.frame.lines[0]!.spans[0]!
    expect(span).toMatchObject({
      text: "界",
      width: 2,
      fg: 0x010203,
      bg: 0x040506,
      attributes: 255,
    })
    expect(sample!.frame.cursor).toEqual({ row: 1, col: 3, visible: true })
    expect(sample!.frame.lines[0]!.spans.reduce((width, value) => width + value.width, 0)).toBe(8)
  })
})
