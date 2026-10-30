import { describe, expect, test } from "bun:test"
import { Option } from "effect"
import { decodePersistentPtyMessage, persistentPtyFrame } from "../src/solid"

const info = {
  id: "pty_1",
  title: "zsh",
  command: "/bin/zsh",
  args: [],
  cwd: "/repo",
  status: "running",
  pid: 42,
  sessionID: "ses_1",
  foregroundProcess: null,
  size: { cols: 80, rows: 24 },
  output: { head: 0, tail: 128 },
}

const decode = (value: object) => Option.getOrUndefined(decodePersistentPtyMessage(JSON.stringify(value)))

describe("decodePersistentPtyMessage", () => {
  test("decodes every message the server sends, keeping only the fields clients read", () => {
    const replay = { requestedOffset: 128, availableOffset: 0, endOffset: 256, truncated: false }

    expect(
      [
        { type: "attached", inputProtocol: 1, info, role: "controller", generation: 3, replay },
        { type: "replay_complete", endOffset: 256 },
        { type: "resized", cols: 100, rows: 30, generation: 4, checkpoint: "G2M=" },
        { type: "controller_changed", attachmentID: "attachment-1", generation: 5 },
        { type: "exited", exitCode: 0, finalOffset: 512 },
        { type: "title_changed", title: "vim" },
        { type: "foreground_process_changed", process: "vim" },
        { type: "foreground_process_changed", process: null },
      ].map(decode),
    ).toEqual([
      { type: "attached", inputProtocol: 1, info: { size: info.size }, role: "controller" },
      { type: "replay_complete" },
      { type: "resized", cols: 100, rows: 30, checkpoint: "G2M=" },
      { type: "controller_changed", attachmentID: "attachment-1" },
      { type: "exited", exitCode: 0 },
      { type: "title_changed", title: "vim" },
      { type: "foreground_process_changed", process: "vim" },
      { type: "foreground_process_changed", process: null },
    ])
  })

  test("reads only the size from attached terminal info, whatever else the server version sends", () => {
    const attached = (terminal: object) => ({ type: "attached", inputProtocol: 1, info: terminal, role: "controller" })

    expect(decode(attached(info))).toEqual(attached({ size: info.size }))
    expect(decode(attached({ ...info, userTitle: "build", sessionID: "dummy" }))).toEqual(attached({ size: info.size }))
    expect(decode(attached({ id: "pty_1" }))).toBeUndefined()
  })

  test("decodes minimal messages and the fields JSON.stringify drops", () => {
    expect(decode({ type: "attached", info: { size: info.size } })).toEqual({
      type: "attached",
      info: { size: info.size },
    })
    expect(decode({ type: "replay_complete" })).toEqual({ type: "replay_complete" })
    expect(decode({ type: "controller_changed", generation: 5 })).toEqual({ type: "controller_changed" })
    expect(decode({ type: "controller_changed", attachmentID: null })).toEqual({
      type: "controller_changed",
      attachmentID: null,
    })
    expect(decode({ type: "exited", finalOffset: 512 })).toEqual({ type: "exited" })
    expect(decode({ type: "exited", exitCode: null })).toEqual({ type: "exited", exitCode: null })
  })

  test("ignores fields it does not know", () => {
    expect(decode({ type: "title_changed", title: "vim", extra: true })).toEqual({
      type: "title_changed",
      title: "vim",
    })
  })

  test("returns None for unknown message types", () => {
    expect(Option.isNone(decodePersistentPtyMessage(JSON.stringify({ type: "future_message", value: 1 })))).toBe(true)
  })

  test("returns None for malformed input", () => {
    const inputs = [
      "",
      "not json",
      "null",
      "42",
      JSON.stringify({ endOffset: 1 }),
      JSON.stringify({ type: "resized", cols: "100", rows: 30, generation: 4, checkpoint: "" }),
      JSON.stringify({ type: "resized", cols: 100, rows: 30, generation: 4 }),
      JSON.stringify({ type: "attached", inputProtocol: 1, role: "controller", generation: 1 }),
      JSON.stringify({ type: "foreground_process_changed" }),
    ]

    expect(inputs.map((input) => Option.isNone(decodePersistentPtyMessage(input)))).toEqual(inputs.map(() => true))
  })
})

describe("persistentPtyFrame", () => {
  test("encodes a size-only interaction frame", () => {
    expect(Array.from(persistentPtyFrame({ cols: 300, rows: 24 }))).toEqual([0, 1, 44, 0, 24])
  })

  test("encodes an input frame with its data", () => {
    expect(Array.from(persistentPtyFrame({ cols: 80, rows: 513 }, new Uint8Array([104, 105])))).toEqual([
      1, 0, 80, 2, 1, 104, 105,
    ])
  })

  test("encodes empty input as an input frame", () => {
    expect(Array.from(persistentPtyFrame({ cols: 80, rows: 24 }, new Uint8Array()))).toEqual([1, 0, 80, 0, 24])
  })
})
