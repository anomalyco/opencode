import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { DSHClient } from "../../src/session/dsh-client"
import type { SessionNotification } from "@agentclientprotocol/sdk"
import { fileURLToPath } from "node:url"

const fixture = fileURLToPath(new URL("../fixture/dsh-acp.ts", import.meta.url))
const command = [process.execPath, fixture]
const reject = async () => ({ outcome: { outcome: "selected" as const, optionId: "no" } })

function client(mode = "ok", update: (event: SessionNotification) => Promise<void> = async () => {}) {
  return new DSHClient({ type: "dsh", command: [...command, mode], startup_timeout: 3000, shutdown_timeout: 300 }, process.cwd(), {
    update, permission: reject,
  })
}

describe("DSH backend configuration", () => {
  const decode = Schema.decodeUnknownSync(ConfigV1.Info)
  test("native execution remains the default and DSH is explicit", () => {
    expect(decode({}).backend).toBeUndefined()
    expect(decode({ backend: { type: "native" } }).backend?.type).toBe("native")
    expect(decode({ backend: { type: "dsh", command } }).backend?.type).toBe("dsh")
  })
  test("rejects missing commands and invalid timeouts", () => {
    for (const backend of [
      { type: "dsh" }, { type: "dsh", command: [] }, { type: "dsh", command: [""] },
      { type: "dsh", command, startup_timeout: 0 }, { type: "dsh", command, shutdown_timeout: -1 },
      { type: "provider", command },
    ]) expect(() => decode({ backend })).toThrow()
  })
})

test("creates, continues, closes, and resumes a DSH identity", async () => {
  const updates: SessionNotification[] = []
  const first = client("ok", async (event) => { updates.push(event) })
  const id = await first.session()
  try {
    await first.prompt(id, [{ type: "text", text: "hello" }])
    expect(await first.session(id)).toBe(id)
    await first.prompt(id, [{ type: "text", text: "follow-up" }])
    expect(updates.map((event) => event.sessionId)).toEqual([id, id, id, id])
    expect(updates.at(2)?.update).toMatchObject({ content: { text: "turn 2: " } })
  } finally { await first.close() }
  expect(first.alive).toBe(false)
  expect(() => process.kill(first.pid!, 0)).toThrow()
  const resumed = client()
  try { expect(await resumed.session(id)).toBe(id) } finally { await resumed.close() }
})

test("applies an ACP model configuration option", async () => {
  const runtime = client("early-config")
  try {
    const id = await runtime.session()
    const value = JSON.stringify(["deepseek-official", "deepseek-v4-pro"])
    const options = await runtime.setConfigOption(id, "model", value)
    expect(options[0]).toMatchObject({ id: "model", currentValue: value })
  } finally { await runtime.close() }
})

test("delivers updates before prompt completion and cancellation settles the prompt", async () => {
  const visible = Promise.withResolvers<void>()
  const runtime = client("ok", async () => visible.resolve())
  try {
    const id = await runtime.session()
    let completed = false
    const prompt = runtime.prompt(id, [{ type: "text", text: "hold" }]).then((value) => { completed = true; return value })
    await visible.promise
    expect(completed).toBe(false)
    await runtime.cancel(id)
    expect((await prompt).stopReason).toBe("cancelled")
  } finally { await runtime.close() }
})

test("preserves tool order and explicit permission rejection", async () => {
  const updates: SessionNotification[] = []
  const runtime = client("ok", async (event) => { updates.push(event) })
  try {
    await runtime.prompt(await runtime.session(), [{ type: "text", text: "permission" }])
    expect(updates.map((event) => event.update.sessionUpdate)).toEqual([
      "agent_message_chunk", "tool_call", "tool_call_update", "agent_message_chunk",
    ])
    expect(updates[2].update).toMatchObject({ status: "failed" })
  } finally { await runtime.close() }
})

for (const mode of ["wrong", "error", "hang"]) test(`reports ${mode} initialization and reaps its process`, async () => {
  const runtime = client(mode)
  try {
    await expect(runtime.session()).rejects.toThrow("DSH backend:")
  } finally { await runtime.close() }
  expect(() => process.kill(runtime.pid!, 0)).toThrow()
})

test("reports a missing executable without exposing command arguments", async () => {
  const runtime = new DSHClient({ type: "dsh", command: ["/missing/dsh", "SECRET"] }, process.cwd(), {
    update: async () => {}, permission: reject,
  })
  try { await expect(runtime.session()).rejects.toThrow("DSH backend:") } finally { await runtime.close() }
})

test("reaps a runtime that ignores close, EOF, and SIGTERM", async () => {
  const runtime = client("stubborn")
  try { await runtime.session() } finally { await runtime.close() }
  expect(() => process.kill(runtime.pid!, 0)).toThrow()
  await runtime.close()
})

for (const text of ["error", "crash"]) test(`propagates ${text} without remote secrets or retries`, async () => {
  const runtime = client()
  try {
    const result = runtime.prompt(await runtime.session(), [{ type: "text", text }])
    await expect(result).rejects.toThrow("No prompt was retried")
    await expect(result).rejects.not.toThrow("SECRET")
  } finally { await runtime.close() }
})
