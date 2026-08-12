import { createReadStream } from "node:fs"
import type { TimelineHeader, TimelineOutput, TimelineRecord, TimelineResize } from "./types.js"

function fail(line: number, message: string): never {
  throw new Error(`Invalid recording timeline at line ${line}: ${message}`)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]) {
  const actual = Object.keys(value).sort()
  return actual.length === expected.length && actual.every((key, index) => key === expected[index])
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
}

function nonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}

function canonicalBase64(value: string) {
  if (value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    return false
  }
  return Buffer.from(value, "base64").toString("base64") === value
}

function parseRecord(text: string, line: number, first: boolean, previousAt: number): TimelineRecord {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    fail(line, "line is not valid JSON")
  }
  if (!isObject(value)) fail(line, "record must be an object")

  if (first) {
    if (!hasExactKeys(value, ["cols", "encoding", "rows", "type", "version"])) fail(line, "invalid header fields")
    if (value.type !== "header" || value.version !== 1 || value.encoding !== "base64") {
      fail(line, "unsupported or missing header")
    }
    if (!positiveInteger(value.cols) || !positiveInteger(value.rows)) fail(line, "cols and rows must be positive integers")
    return { type: "header", version: 1, cols: value.cols, rows: value.rows, encoding: "base64" } satisfies TimelineHeader
  }

  if (!nonnegativeInteger(value.at_ms)) fail(line, "at_ms must be a nonnegative integer")
  if (value.at_ms < previousAt) fail(line, "event timestamps must be nondecreasing")
  if (value.type === "output") {
    if (!hasExactKeys(value, ["at_ms", "data", "type"])) fail(line, "invalid output fields")
    if (typeof value.data !== "string" || !canonicalBase64(value.data)) fail(line, "data must be canonical base64")
    return { type: "output", at_ms: value.at_ms, data: value.data } satisfies TimelineOutput
  }
  if (value.type === "resize") {
    if (!hasExactKeys(value, ["at_ms", "cols", "rows", "type"])) fail(line, "invalid resize fields")
    if (!positiveInteger(value.cols) || !positiveInteger(value.rows)) fail(line, "cols and rows must be positive integers")
    return { type: "resize", at_ms: value.at_ms, cols: value.cols, rows: value.rows } satisfies TimelineResize
  }
  return fail(line, "invalid event type")
}

/** Decodes and validates a timeline without loading the complete file into memory. */
export async function* decodeTimeline(path: string): AsyncGenerator<TimelineRecord> {
  const decoder = new TextDecoder("utf-8", { fatal: true })
  let buffered = ""
  let line = 0
  let records = 0
  let previousAt = -1

  const consume = (raw: string) => {
    line++
    const text = raw.endsWith("\r") ? raw.slice(0, -1) : raw
    if (text.length === 0) fail(line, "empty lines are not allowed")
    const record = parseRecord(text, line, records === 0, previousAt)
    records++
    if (record.type !== "header") previousAt = record.at_ms
    return record
  }

  try {
    for await (const chunk of createReadStream(path)) {
      buffered += decoder.decode(chunk, { stream: true })
      let newline: number
      while ((newline = buffered.indexOf("\n")) !== -1) {
        const raw = buffered.slice(0, newline)
        buffered = buffered.slice(newline + 1)
        yield consume(raw)
      }
    }
    buffered += decoder.decode()
  } catch (error) {
    if (error instanceof TypeError) fail(line + 1, "file is not valid UTF-8")
    throw error
  }

  if (buffered.length > 0) yield consume(buffered)
  if (records === 0) fail(1, "missing header")
}
