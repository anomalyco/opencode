import { describe, expect, test } from "bun:test"
import {
  createPickedFileState,
  transitionPickedFiles,
  type PickedFileCommand,
  type PickedFileEvent,
  type PickedFileState,
} from "./attachment-picker-machine"

// Folds events through the machine and keeps the commands of each step.
function replay(events: readonly PickedFileEvent[], from = createPickedFileState()) {
  return events.reduce<{ state: PickedFileState; commands: (readonly PickedFileCommand[])[] }>(
    (result, event) => {
      const next = transitionPickedFiles(result.state, event)

      return { state: next.state, commands: [...result.commands, next.commands] }
    },
    { state: from, commands: [] },
  )
}

// Sender 1 opens dialog 1 and is granted `paths` under token "t" with a 10 byte budget.
const granted = (paths: readonly string[]): PickedFileEvent[] => [
  { type: "picker.opened", sender: 1 },
  { type: "selection.granted", picker: 1, token: "t", paths, budget: 10 },
]

const bytes = (length: number) => new ArrayBuffer(length)

describe("picked file authorizations", () => {
  test("claims a file while it reads and refuses a second read of it", () => {
    const run = replay([
      ...granted(["a.txt"]),
      { type: "read.requested", sender: 1, token: "t", path: "a.txt" },
      { type: "read.requested", sender: 1, token: "t", path: "a.txt" },
    ])

    expect(run.commands.slice(2)).toEqual([
      [{ type: "read", attempt: 2, maxBytes: 10 }],
      [{ type: "reject", reason: "not-selected" }],
    ])
  })

  test("gives a file back without charging the budget when its read fails or is cancelled", () => {
    const run = replay([
      ...granted(["a.txt"]),
      { type: "read.requested", sender: 1, token: "t", path: "a.txt" },
      { type: "read.failed", attempt: 2, token: "t", path: "a.txt" },
      { type: "read.requested", sender: 1, token: "t", path: "a.txt" },
      { type: "read.cancelled", attempt: 3, token: "t", path: "a.txt" },
      { type: "read.requested", sender: 1, token: "t", path: "a.txt" },
      { type: "read.succeeded", attempt: 4, token: "t", path: "a.txt", bytes: bytes(10) },
      { type: "read.requested", sender: 1, token: "t", path: "a.txt" },
    ])

    expect(run.commands.slice(2)).toEqual([
      [{ type: "read", attempt: 2, maxBytes: 10 }],
      [{ type: "reject", reason: "read-failed" }],
      [{ type: "read", attempt: 3, maxBytes: 10 }],
      [],
      [{ type: "read", attempt: 4, maxBytes: 10 }],
      [{ type: "unwatch-sender", sender: 1 }, { type: "resolve" }],
      [{ type: "reject", reason: "not-selected" }],
    ])
  })

  test("keeps concurrent reads of one selection within its budget", () => {
    const run = replay([
      ...granted(["a.txt", "b.txt"]),
      { type: "read.requested", sender: 1, token: "t", path: "a.txt" },
      { type: "read.requested", sender: 1, token: "t", path: "b.txt" },
      { type: "read.succeeded", attempt: 2, token: "t", path: "a.txt", bytes: bytes(6) },
      { type: "read.succeeded", attempt: 3, token: "t", path: "b.txt", bytes: bytes(6) },
      { type: "read.requested", sender: 1, token: "t", path: "b.txt" },
    ])

    expect(run.commands.slice(2)).toEqual([
      [{ type: "read", attempt: 2, maxBytes: 10 }],
      [{ type: "read", attempt: 3, maxBytes: 10 }],
      [{ type: "resolve" }],
      [{ type: "reject", reason: "size-limit" }],
      [{ type: "read", attempt: 4, maxBytes: 4 }],
    ])
  })

  test("drops a reloaded renderer's selections and dialogs and keeps other renderers'", () => {
    const run = replay([
      ...granted(["a.txt"]),
      { type: "picker.opened", sender: 1 },
      { type: "picker.opened", sender: 2 },
      { type: "selection.granted", picker: 3, token: "u", paths: ["b.txt"], budget: 10 },
      { type: "read.requested", sender: 1, token: "t", path: "a.txt" },
      { type: "sender.cleared", sender: 1 },
      { type: "read.succeeded", attempt: 4, token: "t", path: "a.txt", bytes: bytes(1) },
      { type: "selection.granted", picker: 2, token: "v", paths: ["c.txt"], budget: 10 },
      { type: "read.requested", sender: 2, token: "u", path: "b.txt" },
    ])

    expect(run.commands[0]).toEqual([{ type: "watch-sender", sender: 1 }, { type: "picker-opened", picker: 1 }])
    expect(run.commands.slice(6)).toEqual([
      [{ type: "unwatch-sender", sender: 1 }],
      [{ type: "reject", reason: "not-selected" }],
      [],
      [{ type: "read", attempt: 5, maxBytes: 10 }],
    ])
  })

  test("unwatches every renderer and refuses late results once disposed", () => {
    const run = replay([
      ...granted(["a.txt"]),
      { type: "read.requested", sender: 1, token: "t", path: "a.txt" },
      { type: "picker.opened", sender: 2 },
      { type: "disposed" },
      { type: "read.succeeded", attempt: 2, token: "t", path: "a.txt", bytes: bytes(1) },
    ])

    expect(run.commands.slice(4)).toEqual([
      [
        { type: "unwatch-sender", sender: 2 },
        { type: "unwatch-sender", sender: 1 },
      ],
      [{ type: "reject", reason: "not-selected" }],
    ])
  })

  test("ignores a release from another renderer and stale results", () => {
    const start = replay([...granted(["a.txt"])]).state

    expect(transitionPickedFiles(start, { type: "selection.released", sender: 2, token: "t" }).state).toBe(start)
    expect(transitionPickedFiles(start, { type: "read.cancelled", attempt: 9, token: "t", path: "a.txt" }).state).toBe(
      start,
    )
  })
})
