import { expect, test } from "bun:test"
import {
  ACCOUNTING_CURRENCY,
  contextPercent,
  sumKnownCost,
  sumKnownTokens,
  sumUsageRecords,
  tokenTotal,
  type TokenUsage,
  type UsageRecord,
} from "./telemetry"

const tokens = (input: number, output = 0, reasoning = 0, read = 0, write = 0): TokenUsage => ({
  input,
  output,
  reasoning,
  cache: { read, write },
})

const record = (overrides: Partial<UsageRecord> = {}): UsageRecord => ({
  serverKey: "wsl",
  sessionID: "root",
  messageID: "msg-1",
  currency: ACCOUNTING_CURRENCY,
  complete: true,
  ...overrides,
})

test("unknown cost is not silently zero", () => {
  expect(sumKnownCost([undefined])).toEqual({ value: undefined, coverage: "unavailable" })
  expect(sumKnownCost([0.25, undefined])).toEqual({ value: 0.25, coverage: "partial" })
  expect(sumKnownCost([0])).toEqual({ value: 0, coverage: "complete" })
})

test("an empty or entirely missing usage set is unavailable instead of zero", () => {
  expect(sumKnownCost([])).toEqual({ value: undefined, coverage: "unavailable" })
  expect(sumKnownTokens([])).toEqual({ value: undefined, coverage: "unavailable" })
  expect(sumKnownTokens([undefined])).toEqual({ value: undefined, coverage: "unavailable" })
  const aggregate = sumUsageRecords([])
  expect(aggregate.cost).toEqual({ value: undefined, coverage: "unavailable" })
  expect(aggregate.tokens).toEqual({ value: undefined, coverage: "unavailable" })
  expect(aggregate.records).toBe(0)
  expect(aggregate.contextPercent).toBeUndefined()
})

test("a reported zero is a known value rather than missing usage", () => {
  expect(sumKnownTokens([tokens(0)])).toEqual({ value: 0, coverage: "complete" })
  const aggregate = sumUsageRecords([record({ cost: 0, tokens: tokens(0) })])
  expect(aggregate.cost).toEqual({ value: 0, coverage: "complete" })
  expect(aggregate.tokens).toEqual({ value: 0, coverage: "complete" })
})

test("duplicate message pages are counted once by server, session, and message", () => {
  const aggregate = sumUsageRecords([
    record({ messageID: "msg-1", cost: 0.5, tokens: tokens(100) }),
    record({ messageID: "msg-1", cost: 9.5, tokens: tokens(900) }),
    record({ messageID: "msg-2", cost: 0.25, tokens: tokens(50) }),
  ])
  expect(aggregate.cost).toEqual({ value: 0.75, coverage: "complete" })
  expect(aggregate.tokens).toEqual({ value: 150, coverage: "complete" })
  expect(aggregate.duplicates).toBe(1)
  expect(aggregate.records).toBe(2)
})

test("an inclusive parent summary is never added to its children", () => {
  const aggregate = sumUsageRecords([
    record({ sessionID: "root", messageID: undefined, inclusive: true, cost: 5, tokens: tokens(500) }),
    record({ sessionID: "root", messageID: "msg-1", cost: 1, tokens: tokens(100) }),
    record({ sessionID: "child", parentSessionID: "root", messageID: "msg-2", cost: 2, tokens: tokens(200) }),
  ])
  expect(aggregate.cost).toEqual({ value: 5, coverage: "complete" })
  expect(aggregate.tokens).toEqual({ value: 500, coverage: "complete" })
  expect(aggregate.records).toBe(1)
  expect(aggregate.rejected.inclusive).toBe(2)
})

test("a session summary replaces its own messages without dropping a child session", () => {
  const aggregate = sumUsageRecords([
    record({ sessionID: "root", messageID: undefined, cost: 3, tokens: tokens(300) }),
    record({ sessionID: "root", messageID: "msg-1", cost: 1, tokens: tokens(100) }),
    record({ sessionID: "child", parentSessionID: "root", messageID: "msg-2", cost: 2, tokens: tokens(200) }),
  ])
  expect(aggregate.cost).toEqual({ value: 5, coverage: "complete" })
  expect(aggregate.records).toBe(2)
  expect(aggregate.rejected.inclusive).toBe(1)
})

test("another server's accounting is excluded and another currency keeps its tokens", () => {
  const aggregate = sumUsageRecords(
    [
      record({ messageID: "msg-1", cost: 1, tokens: tokens(10) }),
      record({ serverKey: "ssh:other", messageID: "msg-2", cost: 100, tokens: tokens(1000) }),
      record({ messageID: "msg-3", cost: 2, tokens: tokens(20), currency: "EUR" }),
      record({ messageID: "msg-4", cost: undefined, tokens: undefined, complete: false }),
    ],
    { serverKey: "wsl" },
  )
  expect(aggregate.cost).toEqual({ value: 1, coverage: "partial" })
  expect(aggregate.tokens).toEqual({ value: 30, coverage: "partial" })
  expect(aggregate.rejected.server).toBe(1)
  expect(aggregate.rejected.currency).toBe(1)
})

test("a currency mismatch excludes only the cost and keeps token coverage", () => {
  const aggregate = sumUsageRecords([
    record({ messageID: "msg-1", cost: 1, tokens: tokens(10) }),
    record({ messageID: "msg-2", cost: 2, tokens: tokens(20), currency: "EUR" }),
  ])
  expect(aggregate.cost).toEqual({ value: 1, coverage: "partial" })
  expect(aggregate.tokens).toEqual({ value: 30, coverage: "complete" })
  expect(aggregate.rejected.currency).toBe(1)
})

test("cost is unavailable when every reported cost is in another currency", () => {
  const aggregate = sumUsageRecords([record({ messageID: "msg-1", cost: 2, tokens: tokens(20), currency: "EUR" })])
  expect(aggregate.cost).toEqual({ value: undefined, coverage: "unavailable" })
  expect(aggregate.tokens).toEqual({ value: 20, coverage: "complete" })
  expect(aggregate.rejected.currency).toBe(1)
})

test("an incomplete native tree makes known usage partial", () => {
  const partial = sumUsageRecords([record({ messageID: "msg-1", cost: 1, tokens: tokens(10) })], { complete: false })
  expect(partial.cost).toEqual({ value: 1, coverage: "partial" })
  expect(partial.tokens).toEqual({ value: 10, coverage: "partial" })
  const missing = sumUsageRecords([], { complete: false })
  expect(missing.cost).toEqual({ value: undefined, coverage: "unavailable" })
  expect(missing.tokens).toEqual({ value: undefined, coverage: "unavailable" })
})

test("an incompletely loaded page makes coverage partial even when values are known", () => {
  const aggregate = sumUsageRecords([
    record({ messageID: "msg-1", cost: 1, tokens: tokens(10) }),
    record({ messageID: "msg-2", cost: 2, tokens: tokens(20), complete: false }),
  ])
  expect(aggregate.cost).toEqual({ value: 3, coverage: "partial" })
  expect(aggregate.tokens).toEqual({ value: 30, coverage: "partial" })
})

test("a runtime without native usage reports unavailable instead of fabricating a value", () => {
  const aggregate = sumUsageRecords([record({ cost: undefined, tokens: undefined, complete: false })])
  expect(aggregate.cost.coverage).toBe("unavailable")
  expect(aggregate.tokens.coverage).toBe("unavailable")
  expect(aggregate.cost.value).toBeUndefined()
  expect(aggregate.tokens.value).toBeUndefined()
})

test("a context percentage requires a verified usage denominator", () => {
  expect(contextPercent(500, 1000)).toBe(50)
  expect(contextPercent(0, 1000)).toBe(0)
  expect(contextPercent(500, undefined)).toBeUndefined()
  expect(contextPercent(undefined, 1000)).toBeUndefined()
  expect(contextPercent(500, 0)).toBeUndefined()
  expect(contextPercent(500, Number.NaN)).toBeUndefined()
  expect(sumUsageRecords([record({ cost: 1, tokens: tokens(500) })]).contextPercent).toBeUndefined()
})

test("token totals combine every recorded component without mixing records", () => {
  expect(tokenTotal(tokens(1, 2, 3, 4, 5))).toBe(15)
  expect(sumKnownTokens([tokens(1), undefined, tokens(2)])).toEqual({ value: 3, coverage: "partial" })
})
