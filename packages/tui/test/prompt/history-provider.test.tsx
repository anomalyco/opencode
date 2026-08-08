/** @jsxImportSource @opentui/solid */
import { testRender } from "@opentui/solid"
import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { TuiPathsProvider } from "../../src/context/runtime"
import { PromptHistoryProvider, usePromptHistory } from "../../src/prompt/history"
import { tmpdir } from "../fixture/fixture"

test("down rejects at the newest history item with an empty prompt", async () => {
  await using tmp = await tmpdir()
  const state = path.join(tmp.path, "state")
  await mkdir(state, { recursive: true })
  let history: ReturnType<typeof usePromptHistory>

  function Consumer() {
    history = usePromptHistory()
    return <box />
  }

  const app = await testRender(() => (
    <TuiPathsProvider value={{ cwd: tmp.path, home: tmp.path, state, worktree: tmp.path }}>
      <PromptHistoryProvider>
        <Consumer />
      </PromptHistoryProvider>
    </TuiPathsProvider>
  ))
  try {
    await app.renderOnce()
    history!.append("ses_one", { text: "previous", files: [], agents: [], pasted: [] })

    expect(history!.move("ses_one", 1, "")).toBeUndefined()
    expect(history!.move("ses_one", -1, "")?.text).toBe("previous")
    expect(history!.move("ses_one", 1, "previous")?.text).toBe("")

    history!.append("ses_two", { text: "other", files: [], agents: [], pasted: [] })
    expect(history!.move("ses_two", -1, "")?.text).toBe("other")
    expect(history!.move("ses_one", -1, "")?.text).toBe("previous")
  } finally {
    app.renderer.destroy()
  }
})
