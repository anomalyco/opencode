export * as PtyHandoff from "./pty-handoff.js"

import type { PersistentPty } from "@opencode-ai/schema/persistent-pty"
import { readFile, rename, rm, writeFile } from "node:fs/promises"
import type { Info } from "./service.js"

type Sidecar = {
  readonly source: Pick<Info, "id" | "pid" | "url">
  readonly handoff: PersistentPty.Handoff | null
  readonly expiresAt: number
}

/** Publish the ticket before stopping its owner so every replacement contender can adopt it. */
export async function prepare(file: string, info: Info, timeout: number) {
  const existing = await read(file)
  if (existing !== undefined && existing.expiresAt > Date.now() && same(existing.source, info)) return
  const { ClientError, OpenCode } = await import("./promise/index.js")
  const client = OpenCode.make({
    baseUrl: info.url,
    headers:
      info.password === undefined
        ? undefined
        : { authorization: "Basic " + Buffer.from(`opencode:${info.password}`).toString("base64") },
  })
  const missing = (error: unknown) =>
    error instanceof ClientError &&
    error.reason === "UnexpectedStatus" &&
    typeof error.cause === "object" &&
    error.cause !== null &&
    "status" in error.cause &&
    error.cause.status === 404
  const result = await client.experimental.persistentPty.handoff({ signal: AbortSignal.timeout(timeout) }).then(
    (value) => ({ value }),
    (cause: unknown) => ({ cause }),
  )
  if ("cause" in result) {
    // Another caller may already have prepared and stopped this server.
    const concurrent = await read(file)
    if (concurrent !== undefined && concurrent.expiresAt > Date.now() && same(concurrent.source, info)) return
    if (!missing(result.cause))
      throw new Error("Failed to prepare persistent terminals for service replacement", { cause: result.cause })
    console.warn("Background service cannot hand off persistent terminals; shutting them down before replacement")
    await client.experimental.persistentPty
      .shutdown({ signal: AbortSignal.timeout(timeout) })
      .catch((cause: unknown) => {
        if (missing(cause)) return
        throw new Error("Failed to shut down persistent terminals before service replacement", { cause })
      })
    await publish(file, info, null)
    return
  }
  const body: unknown = result.value
  if (typeof body !== "object" || body === null || !("handoff" in body))
    throw new Error("Invalid persistent terminal handoff response")
  if (body.handoff === null) {
    await publish(file, info, null)
    return
  }
  if (!isHandoff(body.handoff) || body.handoff.expiresAt <= Date.now())
    throw new Error("Invalid or expired persistent terminal handoff")
  await publish(file, info, body.handoff)
}

async function publish(file: string, info: Info, handoff: PersistentPty.Handoff | null) {
  const temporary = `${file}.pty-handoff.${crypto.randomUUID()}.tmp`
  await writeFile(
    temporary,
    JSON.stringify({
      source: { id: info.id, pid: info.pid, url: info.url },
      handoff,
      expiresAt: handoff?.expiresAt ?? Date.now() + 30_000,
    } satisfies Sidecar),
    { mode: 0o600, flag: "wx" },
  )
  await rename(temporary, file + ".pty-handoff").finally(() => rm(temporary, { force: true }))
}

export async function environment(file: string, env?: Readonly<Record<string, string>>) {
  const record = await read(file)
  const current: Info | undefined = await readFile(file, "utf8")
    .then((text) => JSON.parse(text))
    .catch(() => undefined)
  const handoff =
    record !== undefined && record.expiresAt > Date.now() && (current === undefined || same(record.source, current))
      ? record.handoff
      : undefined
  return { ...env, OPENCODE_PTY_HANDOFF: handoff == null ? undefined : JSON.stringify(handoff) }
}

export async function complete(file: string, info: Info) {
  const record = await read(file)
  if (record !== undefined && !same(record.source, info)) await clear(file)
}

export async function clear(file: string) {
  await rm(file + ".pty-handoff", { force: true })
}

async function read(file: string): Promise<Sidecar | undefined> {
  const value: unknown = await readFile(file + ".pty-handoff", "utf8")
    .then((text) => JSON.parse(text))
    .catch(() => undefined)
  if (typeof value !== "object" || value === null || !("source" in value) || !("handoff" in value)) return
  if (typeof value.source !== "object" || value.source === null) return
  if (!("pid" in value.source) || typeof value.source.pid !== "number") return
  if (!("url" in value.source) || typeof value.source.url !== "string") return
  if ("id" in value.source && typeof value.source.id !== "string") return
  if (value.handoff !== null && !isHandoff(value.handoff)) return
  if (!("expiresAt" in value) || typeof value.expiresAt !== "number" || !Number.isFinite(value.expiresAt)) return
  return {
    source: {
      id: "id" in value.source && typeof value.source.id === "string" ? value.source.id : undefined,
      pid: value.source.pid,
      url: value.source.url,
    },
    handoff: value.handoff,
    expiresAt: value.expiresAt,
  }
}

function same(left: Sidecar["source"], right: Info) {
  return left.id === right.id && left.pid === right.pid && left.url === right.url
}

function isHandoff(value: unknown): value is PersistentPty.Handoff {
  return (
    typeof value === "object" &&
    value !== null &&
    "directory" in value &&
    typeof value.directory === "string" &&
    "instanceID" in value &&
    typeof value.instanceID === "string" &&
    "ticket" in value &&
    typeof value.ticket === "string" &&
    "expiresAt" in value &&
    typeof value.expiresAt === "number" &&
    Number.isFinite(value.expiresAt)
  )
}
