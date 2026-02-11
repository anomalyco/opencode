import { describe, expect, test } from "bun:test"
import { Terminal as HeadlessTerminal } from "@xterm/headless"
import { SerializeAddon } from "@xterm/addon-serialize"
import { createModeScanner } from "./mode-scan"

type Snapshot = {
  snapshotAnsi: string
  rehydrateSequences: string
}

type Pipeline = ReturnType<typeof createPipeline>

function createPipeline() {
  const terminal = new HeadlessTerminal({ cols: 80, rows: 24, scrollback: 1000, allowProposedApi: true })
  const serialize = new SerializeAddon()
  terminal.loadAddon(serialize)

  const mode = createModeScanner()

  return {
    async write(chunk: string) {
      mode.scan(chunk)
      if (!chunk) return
      await writeSync(terminal, chunk)
    },
    async snapshot(): Promise<Snapshot> {
      await writeSync(terminal, "")
      return {
        snapshotAnsi: serialize.serialize({ scrollback: 1000 }),
        rehydrateSequences: mode.bracketed() ? "\u001b[?2004h" : "",
      }
    },
    bracketed() {
      return mode.bracketed()
    },
    dispose() {
      terminal.dispose()
    },
  }
}

async function applySnapshot(pipeline: Pipeline, snapshot: Snapshot) {
  if (snapshot.rehydrateSequences) {
    await pipeline.write(snapshot.rehydrateSequences)
  }
  await pipeline.write(snapshot.snapshotAnsi)
}

function writeSync(terminal: HeadlessTerminal, data: string): Promise<void> {
  return new Promise((resolve) => {
    terminal.write(data, () => resolve())
  })
}

async function renderRaw(chunks: string[]) {
  const terminal = new HeadlessTerminal({ cols: 80, rows: 24, scrollback: 1000, allowProposedApi: true })
  const serialize = new SerializeAddon()
  terminal.loadAddon(serialize)

  try {
    for (const chunk of chunks) {
      await writeSync(terminal, chunk)
    }
    await writeSync(terminal, "")
    return serialize.serialize({ scrollback: 1000 })
  } finally {
    terminal.dispose()
  }
}

describe("headless emulator terminal pipeline", () => {
  test("xterm handles query responses without displaying them", async () => {
    const pipeline = createPipeline()

    try {
      await pipeline.write("$ ")
      await pipeline.write("echo hello\\r\\n")
      await pipeline.write("\u001b[12;34R")
      await pipeline.write("\u001b[I")
      await pipeline.write("\u001b[?2004;1$y")
      await pipeline.write("hello\\r\\n")

      const snapshot = await pipeline.snapshot()

      expect(snapshot.snapshotAnsi).toContain("$ echo hello")
      expect(snapshot.snapshotAnsi).toContain("hello")
      expect(snapshot.snapshotAnsi).not.toContain("[12;34R")
      expect(snapshot.snapshotAnsi).not.toContain("[?2004;1$y")
    } finally {
      pipeline.dispose()
    }
  })

  test("preserves non-query CSI sequences (false-positive guard)", async () => {
    const pipeline = createPipeline()
    const chunks = ["A\u001b[cb", "B\u001b[22;0tc"]

    try {
      for (const chunk of chunks) {
        await pipeline.write(chunk)
      }

      const snapshot = await pipeline.snapshot()
      const baseline = await renderRaw(chunks)

      expect(snapshot.snapshotAnsi).toBe(baseline)
    } finally {
      pipeline.dispose()
    }
  })

  test("rehydrates bracketed paste mode from snapshot across split chunks", async () => {
    const source = createPipeline()
    const target = createPipeline()

    try {
      // Enable bracketed paste via split chunks
      await source.write("\u001b[?20")
      await source.write("04h")
      await source.write("app\\r\\n")

      const snapshot = await source.snapshot()
      expect(snapshot.rehydrateSequences).toContain("\u001b[?2004h")

      // Restore snapshot into a fresh pipeline
      await applySnapshot(target, snapshot)
      const restored = await target.snapshot()

      // Bracketed paste should survive the round-trip
      expect(restored.rehydrateSequences).toContain("\u001b[?2004h")
      expect(restored.snapshotAnsi).toContain("app")
    } finally {
      source.dispose()
      target.dispose()
    }
  })

  test("xterm handles split query responses across chunk boundaries", async () => {
    const pipeline = createPipeline()

    try {
      await pipeline.write("prefix\u001b[12;")
      await pipeline.write("34Rsuffix")

      const snapshot = await pipeline.snapshot()

      expect(snapshot.snapshotAnsi).toContain("prefixsuffix")
      expect(snapshot.snapshotAnsi).not.toContain("[12;34R")
    } finally {
      pipeline.dispose()
    }
  })

  test("restores serialized screen content in a fresh emulator", async () => {
    const source = createPipeline()
    const target = createPipeline()

    try {
      for (let i = 1; i <= 40; i++) {
        await source.write(`line-${i}\\r\\n`)
      }

      const snapshot = await source.snapshot()
      await applySnapshot(target, snapshot)
      const restored = await target.snapshot()

      expect(restored.snapshotAnsi).toContain("line-1")
      expect(restored.snapshotAnsi).toContain("line-20")
      expect(restored.snapshotAnsi).toContain("line-40")
    } finally {
      source.dispose()
      target.dispose()
    }
  })
})
