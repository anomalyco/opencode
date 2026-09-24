/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import path from "path"
import { readdir } from "fs/promises"
import { TuiAppProvider } from "../../src/context/runtime"
import { StorageProvider } from "../../src/context/storage"
import { tmpdir } from "../fixture/fixture"
import { TestTuiContexts } from "../fixture/tui-environment"

test("supports channels containing slashes", async () => {
  await using temporary = await tmpdir()
  const app = await testRender(() => (
    <TestTuiContexts paths={{ state: temporary.path }}>
      <TuiAppProvider value={{ name: "test", version: "test", channel: "fix/repro" }}>
        <StorageProvider>
          <box />
        </StorageProvider>
      </TuiAppProvider>
    </TestTuiContexts>
  ))

  try {
    expect(await readdir(temporary.path)).toEqual(["encoded-Zml4L3JlcHJv"])
    expect(await readdir(path.join(temporary.path, "encoded-Zml4L3JlcHJv"))).toEqual(["tui"])
  } finally {
    app.renderer.destroy()
  }
})
