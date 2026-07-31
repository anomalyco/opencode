/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { mkdtempSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { TuiAppProvider } from "../../src/context/runtime"
import { StorageProvider, useStorage, type Storage } from "../../src/context/storage"
import { TestTuiContexts } from "../fixture/tui-environment"

test("memory storage is synchronous, keyed, and stable across lookups", async () => {
  let storage!: Storage
  function Probe() {
    storage = useStorage()
    return <box />
  }
  await testRender(() => (
    <TestTuiContexts paths={{ state: mkdtempSync(path.join(tmpdir(), "opencode-storage-test-")) }}>
      <TuiAppProvider value={{ name: "test", version: "test", channel: "test" }}>
        <StorageProvider>
          <Probe />
        </StorageProvider>
      </TuiAppProvider>
    </TestTuiContexts>
  ))

  const [state, update] = storage.memory("tick", { initial: { count: 0, at: undefined as Date | undefined } })
  // Synchronous update, no JSON round-trip: a Date survives as-is.
  const now = new Date()
  update((draft) => {
    draft.count += 1
    draft.at = now
  })
  expect(state.count).toBe(1)
  expect(state.at).toBe(now)

  // Same key returns the same live store (what hot-reload survival relies
  // on); a different key is isolated.
  const [again] = storage.memory("tick", { initial: { count: 99, at: undefined as Date | undefined } })
  expect(again).toBe(state)
  expect(again.count).toBe(1)
  const [other] = storage.memory("other", { initial: { count: 0 } })
  expect(other.count).toBe(0)
})
