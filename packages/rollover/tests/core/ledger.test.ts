import { describe, expect, test } from "bun:test"
import { activeRecords, nextRecordId, normalizeForDedupe, isDuplicate, pushCap, recordPrefix } from "../../src/core/ledger"
import type { LedgerLine, LedgerRecord } from "../../src/core/types"

const record = (over: Partial<LedgerRecord>): LedgerRecord => ({
  kind: "record",
  id: "o1",
  type: "objective",
  text: "did a thing",
  epoch: 0,
  userMessageId: "u1",
  turnMessageId: "a1",
  createdAt: 0,
  ...over,
})

describe("activeRecords", () => {
  test("returns records without invalidations, in order", () => {
    const lines: LedgerLine[] = [record({ id: "o1" }), record({ id: "d2", type: "decision" })]
    expect(activeRecords(lines).map((r) => r.id)).toEqual(["o1", "d2"])
  })

  test("invalidation removes exactly the target record", () => {
    const lines: LedgerLine[] = [
      record({ id: "d1", type: "decision", text: "use jwt" }),
      record({ id: "d2", type: "decision", text: "use cookies" }),
      { kind: "invalidate", id: "d1", reason: "superseded", by: "d2", at: 1 },
    ]
    expect(activeRecords(lines).map((r) => r.id)).toEqual(["d2"])
  })

  test("record with two invalidations still excluded once", () => {
    const lines: LedgerLine[] = [
      record({ id: "o1" }),
      { kind: "invalidate", id: "o1", reason: "resolved", at: 1 },
      { kind: "invalidate", id: "o1", reason: "duplicate", by: "o2", at: 2 },
    ]
    expect(activeRecords(lines)).toEqual([])
  })

  test("unknown invalidated id is ignored", () => {
    const lines: LedgerLine[] = [record({ id: "o1" }), { kind: "invalidate", id: "zz9", reason: "duplicate", at: 1 }]
    expect(activeRecords(lines).map((r) => r.id)).toEqual(["o1"])
  })
})

describe("nextRecordId", () => {
  const prefixCases: Array<[LedgerRecord["type"], string]> = [
    ["objective", "o"],
    ["decision", "d"],
    ["user_correction", "c"],
    ["open_item", "i"],
    ["verification", "v"],
  ]

  test("prefix map", () => {
    for (const [type, prefix] of prefixCases) expect(recordPrefix(type)).toBe(prefix)
  })

  test("starts at 1 for a fresh type", () => {
    expect(nextRecordId([], "objective")).toBe("o1")
  })

  test("continues from the largest counter for that prefix", () => {
    const lines: LedgerLine[] = [record({ id: "o3" }), record({ id: "i4", type: "open_item" })]
    expect(nextRecordId(lines, "objective")).toBe("o4")
    expect(nextRecordId(lines, "open_item")).toBe("i5")
  })

  test("interleaved counters stay independent", () => {
    const lines: LedgerLine[] = [record({ id: "v5", type: "verification" })]
    expect(nextRecordId(lines, "verification")).toBe("v6")
    expect(nextRecordId(lines, "decision")).toBe("d1")
  })

  test("counter reads invalidation lines too (id continuity)", () => {
    const lines: LedgerLine[] = [record({ id: "d7" }), { kind: "invalidate", id: "d7", reason: "superseded", at: 1 }]
    expect(nextRecordId(lines, "decision")).toBe("d8")
  })
})

describe("normalizeForDedupe", () => {
  test("case, whitespace and punctuation-insensitive", () => {
    expect(normalizeForDedupe("Auth: JWT!")).toBe(normalizeForDedupe("auth jwt"))
    expect(normalizeForDedupe("  Never   touch  tests/legacy/ ")).toBe(normalizeForDedupe("never touch tests/legacy"))
  })

  test("different content stays different", () => {
    expect(normalizeForDedupe("use bun")).not.toBe(normalizeForDedupe("use npm"))
  })
})

describe("isDuplicate", () => {
  test("detects same type + normalized text within lookback", () => {
    const active = [record({ id: "o1", type: "objective", text: "Ship the thing" })]
    expect(isDuplicate({ type: "objective", text: "ship the thing!" }, active)).toBe(true)
  })

  test("different type is not a duplicate", () => {
    const active = [record({ id: "o1", type: "objective", text: "ship the thing" })]
    expect(isDuplicate({ type: "decision", text: "ship the thing" }, active)).toBe(false)
  })

  test("lookback window respected: 31st old record does not dedupe", () => {
    // 31 records: "target fact" is the oldest (index 0), 31st from the end.
    const active: LedgerRecord[] = [
      record({ id: "o1", text: "target fact" }),
      ...Array.from({ length: 30 }, (_, i) => record({ id: `o${i + 2}`, text: `fact ${i}` })),
    ]
    // lookback=30 covers indices 1..30 → the oldest falls outside the window.
    expect(isDuplicate({ type: "objective", text: "target fact" }, active, 30)).toBe(false)
    // with 30 records total, "target fact" at index 0 is inside the window → duplicate.
    const smaller = active.slice(0, 30)
    expect(isDuplicate({ type: "objective", text: "target fact" }, smaller, 30)).toBe(true)
  })
})

describe("pushCap", () => {
  test("keeps newest and caps", () => {
    const arr = ["a", "b", "c"]
    expect(pushCap(arr, "d", 3)).toEqual(["b", "c", "d"])
  })

  test("does not mutate the input", () => {
    const arr = ["a"]
    pushCap(arr, "b", 1)
    expect(arr).toEqual(["a"])
  })

  test("cap larger than array appends", () => {
    expect(pushCap(["a"], "b", 50)).toEqual(["a", "b"])
  })
})
