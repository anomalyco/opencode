import { test, expect, beforeEach } from "bun:test"
import { parseSSELines, isBrowserOpen, createDeduplicator } from "../src/sse"
import type { SSEEvent } from "../src/sse"

test("parseSSELines parses a single event", () => {
  const buffer = 'data: {"type":"browser.open","properties":{"url":"https://example.com"}}\n'
  const result = parseSSELines(buffer)
  expect(result.events.length).toBe(1)
  expect(result.events[0].type).toBe("browser.open")
  expect(result.remainder).toBe("")
})

test("parseSSELines parses multiple events", () => {
  const buffer =
    'data: {"type":"browser.open","properties":{"url":"https://a.com"}}\n' +
    'data: {"type":"browser.open","properties":{"url":"https://b.com"}}\n'
  const result = parseSSELines(buffer)
  expect(result.events.length).toBe(2)
  expect((result.events[0].properties as { url: string }).url).toBe("https://a.com")
  expect((result.events[1].properties as { url: string }).url).toBe("https://b.com")
})

test("parseSSELines preserves incomplete line as remainder", () => {
  const buffer = 'data: {"type":"browser.open","properties":{"url":"https://a.com"}}\ndata: {"type":"bro'
  const result = parseSSELines(buffer)
  expect(result.events.length).toBe(1)
  expect(result.remainder).toBe('data: {"type":"bro')
})

test("parseSSELines skips non-data lines", () => {
  const buffer = 'event: message\ndata: {"type":"ping","properties":{}}\nid: 123\n'
  const result = parseSSELines(buffer)
  expect(result.events.length).toBe(1)
  expect(result.events[0].type).toBe("ping")
})

test("parseSSELines returns empty events for empty buffer", () => {
  const result = parseSSELines("")
  expect(result.events.length).toBe(0)
  expect(result.remainder).toBe("")
})

test("parseSSELines skips malformed JSON", () => {
  const buffer = "data: not-json\ndata: {bad\n" + 'data: {"type":"good","properties":{}}\n'
  const result = parseSSELines(buffer)
  expect(result.events.length).toBe(1)
  expect(result.events[0].type).toBe("good")
})

test("parseSSELines handles buffer with only newlines", () => {
  const result = parseSSELines("\n\n\n")
  expect(result.events.length).toBe(0)
  expect(result.remainder).toBe("")
})

test("isBrowserOpen returns true for browser.open events", () => {
  const event: SSEEvent = { type: "browser.open", properties: { url: "https://example.com" } }
  expect(isBrowserOpen(event)).toBe(true)
})

test("isBrowserOpen returns false for other event types", () => {
  const event: SSEEvent = { type: "ping", properties: {} }
  expect(isBrowserOpen(event)).toBe(false)
})

test("isBrowserOpen returns false when url is missing", () => {
  const event: SSEEvent = { type: "browser.open", properties: {} }
  expect(isBrowserOpen(event)).toBe(false)
})

test("isBrowserOpen returns false when url is not a string", () => {
  const event: SSEEvent = { type: "browser.open", properties: { url: 123 } }
  expect(isBrowserOpen(event)).toBe(false)
})

test("isBrowserOpen preserves callbackPort", () => {
  const event: SSEEvent = { type: "browser.open", properties: { url: "https://x.com", callbackPort: 9999 } }
  expect(isBrowserOpen(event)).toBe(true)
  if (isBrowserOpen(event)) {
    expect(event.properties.callbackPort).toBe(9999)
  }
})

let dedup: ReturnType<typeof createDeduplicator>

beforeEach(() => {
  dedup = createDeduplicator(5000)
})

test("first occurrence is not a duplicate", () => {
  expect(dedup.isDuplicate("https://example.com", 1000)).toBe(false)
})

test("same URL within window is a duplicate", () => {
  dedup.isDuplicate("https://example.com", 1000)
  expect(dedup.isDuplicate("https://example.com", 3000)).toBe(true)
})

test("same URL after window expires is not a duplicate", () => {
  dedup.isDuplicate("https://example.com", 1000)
  expect(dedup.isDuplicate("https://example.com", 7000)).toBe(false)
})

test("different URLs are independent", () => {
  dedup.isDuplicate("https://a.com", 1000)
  expect(dedup.isDuplicate("https://b.com", 1000)).toBe(false)
})

test("same URL at exactly the window boundary is not a duplicate", () => {
  dedup.isDuplicate("https://example.com", 1000)
  expect(dedup.isDuplicate("https://example.com", 6000)).toBe(false)
})

test("clear resets deduplication state", () => {
  dedup.isDuplicate("https://example.com", 1000)
  dedup.clear()
  expect(dedup.isDuplicate("https://example.com", 2000)).toBe(false)
})

test("dedup updates timestamp on non-duplicate re-entry", () => {
  dedup.isDuplicate("https://example.com", 1000)
  expect(dedup.isDuplicate("https://example.com", 7000)).toBe(false)
  expect(dedup.isDuplicate("https://example.com", 10000)).toBe(true)
})

test("end-to-end: parse SSE buffer, filter browser.open, dedup", () => {
  const dedup = createDeduplicator(5000)
  const buffer =
    'data: {"type":"ping","properties":{}}\n' +
    'data: {"type":"browser.open","properties":{"url":"https://auth.com/login","callbackPort":8080}}\n' +
    'data: {"type":"browser.open","properties":{"url":"https://auth.com/login","callbackPort":8080}}\n' +
    'data: {"type":"browser.open","properties":{"url":"https://other.com"}}\n'

  const { events } = parseSSELines(buffer)
  const now = Date.now()
  const actions: Array<{ url: string; callbackPort?: number }> = []

  for (const event of events) {
    if (!isBrowserOpen(event)) continue
    if (dedup.isDuplicate(event.properties.url, now)) continue
    actions.push(event.properties)
  }

  expect(actions.length).toBe(2)
  expect(actions[0].url).toBe("https://auth.com/login")
  expect(actions[0].callbackPort).toBe(8080)
  expect(actions[1].url).toBe("https://other.com")
  expect(actions[1].callbackPort).toBeUndefined()
})
