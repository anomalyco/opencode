import { afterEach, expect, setSystemTime, test } from "bun:test"
import { memoryRecord } from "./memory-record"

afterEach(() => setSystemTime())

test("JSONL correlates renderer heaps and OS memory by pid, with explicit units and unavailable values", () => {
  setSystemTime(new Date("2026-10-23T00:00:00Z"))

  const record = memoryRecord(
    [
      {
        pid: 42,
        type: "Tab",
        creationTime: 1,
        cpu: { percentCPUUsage: 0, cumulativeCPUUsage: 0, idleWakeupsPerSecond: 0 },
        memory: { workingSetSize: 2048, peakWorkingSetSize: 4096 },
      },
    ],
    [
      { id: 7, pid: 42, type: "window", sample: { jsHeap: { used: 1024, total: 4096, limit: 8192 }, domElements: 15 } },
      { id: 8, pid: 43, type: "window", error: "Renderer sample timed out" },
    ],
    true,
  )

  expect(JSON.parse(`${JSON.stringify(record)}\n`)).toEqual({
    timestamp: "2026-10-23T00:00:00.000Z",
    mainPid: process.pid,
    nativeMemoryUnit: "KiB",
    jsHeapUnit: "bytes",
    preciseJsHeap: true,
    processes: [{ type: "Tab", pid: 42, workingSetSize: 2048, privateBytes: null }],
    renderers: [
      {
        id: 7,
        pid: 42,
        type: "window",
        sample: { jsHeap: { used: 1024, total: 4096, limit: 8192 }, domElements: 15 },
        nativeMemory: { workingSetSize: 2048, peakWorkingSetSize: 4096 },
      },
      { id: 8, pid: 43, type: "window", error: "Renderer sample timed out", nativeMemory: null },
    ],
  })
})
