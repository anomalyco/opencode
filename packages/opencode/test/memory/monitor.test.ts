import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import { GlobalBus } from "../../src/bus/global"
import { Memory } from "../../src/memory"

describe("memory monitor", () => {
  afterEach(async () => {
    Memory.stop()
    delete process.env.OPENCODE_MEMORY_MONITOR_INTERVAL_MS
    delete process.env.OPENCODE_MEMORY_MONITOR_RSS_BYTES
    delete process.env.OPENCODE_MEMORY_MONITOR_CONSECUTIVE
    await fs.rm(Memory.DIR, { recursive: true, force: true })
  })

  test("emits memory.high and writes diagnostics", async () => {
    process.env.OPENCODE_MEMORY_MONITOR_INTERVAL_MS = "10"
    process.env.OPENCODE_MEMORY_MONITOR_RSS_BYTES = "1"
    process.env.OPENCODE_MEMORY_MONITOR_CONSECUTIVE = "1"

    const events: { directory?: string; payload: { type: string; properties: Record<string, unknown> } }[] = []
    const handler = (event: { directory?: string; payload: { type: string; properties: Record<string, unknown> } }) => {
      if (event.payload.type === Memory.Event.High.type) events.push(event)
    }

    GlobalBus.on("event", handler)
    Memory.init()
    await wait(async () => (await Memory.reports()).length > 0)
    GlobalBus.off("event", handler)

    const report = await Memory.report()
    expect(report).toBeDefined()
    expect(events.length).toBe(1)
    expect(events[0]?.payload.type).toBe("memory.high")
    expect(events[0]?.directory).toBe("global")
    expect(await Bun.file(report!.report_path).exists()).toBe(true)
    expect(typeof report!.server_proc).toBe("boolean")
    expect(typeof report!.tui_proc).toBe("boolean")
    expect(typeof report!.opencode_version).toBe("string")
    expect(typeof report!.process_lifetime).toBe("number")
    expect(report!.heapdump_path).toBeDefined()
    if (report!.heapdump_path) {
      expect(await Bun.file(report!.heapdump_path).exists()).toBe(true)
    }
  }, 60_000)

  test("creates one dump per process", async () => {
    process.env.OPENCODE_MEMORY_MONITOR_INTERVAL_MS = "10"
    process.env.OPENCODE_MEMORY_MONITOR_RSS_BYTES = "1"
    process.env.OPENCODE_MEMORY_MONITOR_CONSECUTIVE = "1"

    Memory.init()
    await wait(async () => (await Memory.reports()).length > 0)
    await Bun.sleep(200)

    const reports = await Memory.reports()
    expect(reports.length).toBe(1)
  }, 60_000)

  test("manual trigger always writes artifacts and emits event", async () => {
    process.env.OPENCODE_MEMORY_MONITOR_RSS_BYTES = String(1024 * 1024 * 1024 * 1024)
    process.env.OPENCODE_MEMORY_MONITOR_CONSECUTIVE = "999"

    const events: { directory?: string; payload: { type: string; properties: Record<string, unknown> } }[] = []
    const handler = (event: { directory?: string; payload: { type: string; properties: Record<string, unknown> } }) => {
      if (event.payload.type === Memory.Event.High.type) events.push(event)
    }

    GlobalBus.on("event", handler)
    const result = await Memory.trigger()
    GlobalBus.off("event", handler)

    expect(await Bun.file(result.report_path).exists()).toBe(true)
    expect(events.length).toBe(1)
    expect(events[0]?.directory).toBe("global")
  }, 60_000)
})

async function wait(check: () => Promise<boolean>, timeout = 20_000, interval = 50) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await check()) return
    await Bun.sleep(interval)
  }
  throw new Error("timed out waiting for memory dump")
}
