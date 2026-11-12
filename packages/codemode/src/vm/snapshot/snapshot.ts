import type { Interpreter } from "../runtime/interpreter.js"
import type { ToolCall } from "../../tool-runtime.js"
import { type Encoded, type Record, SnapshotError } from "./codec.js"

export { SnapshotError }

/** A snapshot as bytes: UTF-8 JSON. */
export const toBytes = (snapshot: Snapshot): Uint8Array => new TextEncoder().encode(JSON.stringify(snapshot))

/** Reads bytes `toBytes` wrote; `restore` checks what they hold. */
export const fromBytes = (bytes: Uint8Array): unknown => {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
  } catch (error) {
    throw new SnapshotError(`Invalid snapshot: the bytes are not UTF-8 JSON (${String(error)}).`)
  }
}

/** The snapshot format this build writes and reads: the bytecode VM's (see `src/vm/snapshot.ts`). */
export const FORMAT = 2

/**
 * A suspended run's whole state as JSON: a header that says which build and sources it belongs to and what budget it
 * has used, and the graph of records (see codec.ts) rooted at the VM, the interpreter, and the global scope, then
 * every built-in or host global the run changed.
 */
export type Snapshot = {
  readonly format: typeof FORMAT
  readonly header: Header
  readonly roots: ReadonlyArray<Encoded>
  readonly records: ReadonlyArray<Record>
}

export type Header = {
  /** The build that wrote it: the package version, and a hash of the opcodes, the prelude's bytecode, codecs, and built-ins. */
  readonly build: string
  /**
   * A hash of the host's globals (extensions, a test harness), and of each extension's name and whether it has
   * `snapshot` hooks, which the restoring runtime must have too.
   */
  readonly hosts: string
  readonly runId: string
  /** The program texts, re-parsed and recompiled on restore, and checked against their hashes and bytecode hashes. */
  readonly sources: ReadonlyArray<{
    readonly id: string
    readonly code: string
    readonly hash: string
    readonly bytecode: string
  }>
  readonly limits: {
    readonly timeoutMs: number | null
    readonly maxToolCalls: number | null
    readonly maxOutputBytes: number | null
  }
  /** What the run has used so far, across every resume: active milliseconds, and tool calls admitted. */
  readonly budget: { readonly activeMs: number; readonly toolCalls: number }
  /** The tool calls admitted so far. */
  readonly toolCalls: ReadonlyArray<ToolCall>
}

export type SnapshotHeader = Header

export const hostsId = (ctx: Interpreter<unknown>): string =>
  hash(
    [
      ...ctx.intrinsics.hosts(),
      ...(ctx.hosts?.extensions ?? []).map(
        (extension) => `${extension.name} ${extension.hooked ? "hooks" : "no hooks"}`,
      ),
    ].join("\n"),
  )

// --- Validation ---

const fail = (message: string): never => {
  throw new SnapshotError(`Invalid snapshot: ${message}`)
}

const object = (value: unknown, what: string): { readonly [key: string]: unknown } =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as { readonly [key: string]: unknown })
    : fail(`${what} is not an object.`)

const array = (value: unknown, what: string): ReadonlyArray<unknown> =>
  Array.isArray(value) ? value : fail(`${what} is not a list.`)

const string = (value: unknown, what: string): string =>
  typeof value === "string" ? value : fail(`${what} is not text.`)

const number = (value: unknown, what: string): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fail(`${what} is not a number.`)

const limit = (value: unknown, what: string): number | null => (value === null ? null : number(value, what))

/** A saved state's header, checked in full, before anything is restored. */
export const header = (saved: unknown): Header => validate(saved).header

// The header is checked in full; records are checked as they are decoded.
export const validate = (saved: unknown): Snapshot => {
  const root = object(saved, "the snapshot")
  if (root.format !== FORMAT) fail(`format ${String(root.format)} is not ${FORMAT}.`)
  const header = object(root.header, "the header")
  const limits = object(header.limits, "the limits")
  const budget = object(header.budget, "the budget")
  const checked: Header = {
    build: string(header.build, "the build"),
    hosts: string(header.hosts, "the host globals"),
    runId: string(header.runId, "the run id"),
    sources: array(header.sources, "the sources").map((item) => {
      const source = object(item, "a source")
      return {
        id: string(source.id, "a source id"),
        code: string(source.code, "a source"),
        hash: string(source.hash, "a source hash"),
        bytecode: string(source.bytecode, "a bytecode hash"),
      }
    }),
    limits: {
      timeoutMs: limit(limits.timeoutMs, "timeoutMs"),
      maxToolCalls: limit(limits.maxToolCalls, "maxToolCalls"),
      maxOutputBytes: limit(limits.maxOutputBytes, "maxOutputBytes"),
    },
    budget: { activeMs: number(budget.activeMs, "the active time"), toolCalls: number(budget.toolCalls, "tool calls") },
    toolCalls: array(header.toolCalls, "the tool calls").map((item) => ({
      name: string(object(item, "a tool call").name, "a tool name"),
    })),
  }
  const roots = array(root.roots, "the roots")
  if (roots.length < 3) fail("there are fewer than three roots.")
  return {
    format: FORMAT,
    header: checked,
    roots: roots as ReadonlyArray<Encoded>,
    records: array(root.records, "the records") as ReadonlyArray<Record>,
  }
}

// --- Helpers ---

// FNV-1a over UTF-16 code units, twice with different offsets: a fingerprint, not a security check.
export const hash = (text: string): string => {
  let a = 0x811c9dc5
  let b = 0x01000193 ^ 0x9e3779b9
  for (let at = 0; at < text.length; at++) {
    const code = text.charCodeAt(at)
    a = Math.imul(a ^ code, 0x01000193)
    b = Math.imul(b ^ code, 0x01000193) ^ (b >>> 13)
  }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0")
}
