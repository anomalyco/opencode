import { afterEach, describe, expect, setSystemTime, test } from "bun:test"
import path from "node:path"
import { createStorage } from "../../src/context/storage"
import { createPromptDrafts, MAX_DRAFTS_PER_PROJECT, type PromptDraft } from "../../src/prompt/drafts"
import { emptyPrompt } from "../../src/prompt/history"
import { tmpdir } from "../fixture/fixture"

// The Prompt component mirrors its composer here while typing, so an unsent prompt is
// still on disk when the process dies before onCleanup ever runs.

const start = Date.UTC(2026, 6, 1)

afterEach(() => setSystemTime())

function draft(text: string, cursor = text.length): PromptDraft {
  return { prompt: { ...emptyPrompt(), text }, cursor }
}

async function file(root: string) {
  return Bun.file(path.join(root, "test", "tui", "prompt-drafts.json")).json()
}

describe("prompt drafts", () => {
  test("a draft outlives the process that wrote it", async () => {
    await using tmp = await tmpdir()
    const before = createStorage(tmp.path, "test")
    await createPromptDrafts(before.storage).write("/project", "ses_one", draft("an hour of typing"))
    before.close()

    // A restart reads the same state directory back synchronously.
    const after = createStorage(tmp.path, "test")
    expect(createPromptDrafts(after.storage).read("/project", "ses_one")).toEqual({
      ...draft("an hour of typing"),
    })
    after.close()
  })

  test("tabs and projects keep separate drafts", async () => {
    await using tmp = await tmpdir()
    const storage = createStorage(tmp.path, "test")
    const drafts = createPromptDrafts(storage.storage)
    await drafts.write("/project", "home", draft("for the next session"))
    await drafts.write("/project", "ses_one", draft("for session one"))
    await drafts.write("/other", "home", draft("elsewhere"))

    expect(drafts.read("/project", "home")?.prompt.text).toBe("for the next session")
    expect(drafts.read("/project", "ses_one")?.prompt.text).toBe("for session one")
    expect(drafts.read("/other", "home")?.prompt.text).toBe("elsewhere")
    expect(drafts.read("/project", "ses_two")).toBeUndefined()
    expect((await file(tmp.path)).projects["/project"]).toMatchObject({
      home: { prompt: { text: "for the next session" } },
      ses_one: { prompt: { text: "for session one" } },
    })
    storage.close()
  })

  test("clearing an empty composer removes the stored draft", async () => {
    await using tmp = await tmpdir()
    const storage = createStorage(tmp.path, "test")
    const drafts = createPromptDrafts(storage.storage)
    await drafts.write("/project", "ses_one", draft("sent"))
    await drafts.write("/project", "ses_one", undefined)

    expect(drafts.read("/project", "ses_one")).toBeUndefined()
    expect((await file(tmp.path)).projects["/project"]).toEqual({})
    // Nothing to remove is not a write.
    await drafts.write("/project", "ses_one", undefined)
    storage.close()
  })

  test("an unchanged draft is not written again", async () => {
    await using tmp = await tmpdir()
    const storage = createStorage(tmp.path, "test")
    const drafts = createPromptDrafts(storage.storage)
    setSystemTime(new Date(start))
    await drafts.write("/project", "ses_one", draft("same"))
    expect((await file(tmp.path)).projects["/project"].ses_one.savedAt).toBe(start)

    await drafts.write("/project", "ses_one", draft("same"))
    expect((await file(tmp.path)).projects["/project"].ses_one.savedAt).toBe(start)

    setSystemTime(new Date(start + 1000))
    await drafts.write("/project", "ses_one", draft("same", 2))
    expect((await file(tmp.path)).projects["/project"].ses_one).toMatchObject({ cursor: 2, savedAt: start + 1000 })
    storage.close()
  })

  test("a malformed document yields no drafts", async () => {
    await using tmp = await tmpdir()
    const location = path.join(tmp.path, "test", "tui", "prompt-drafts.json")
    await Bun.write(
      location,
      JSON.stringify({
        projects: {
          "/project": {
            ses_missing: { cursor: 3 },
            ses_empty: { prompt: { ...emptyPrompt(), text: "" }, cursor: 0 },
            ses_no_pasted: { prompt: { text: "kept" }, cursor: 1 },
            ses_valid: { prompt: { ...emptyPrompt(), text: "kept too" }, cursor: 2 },
            ses_no_cursor: { prompt: { ...emptyPrompt(), text: "cursorless" } },
          },
        },
      }),
    )
    const storage = createStorage(tmp.path, "test")
    const drafts = createPromptDrafts(storage.storage)

    expect(drafts.read("/project", "ses_missing")).toBeUndefined()
    expect(drafts.read("/project", "ses_empty")).toBeUndefined()
    expect(drafts.read("/project", "ses_no_pasted")).toBeUndefined()
    expect(drafts.read("/project", "ses_valid")).toEqual({ ...draft("kept too"), cursor: 2 })
    expect(drafts.read("/project", "ses_no_cursor")).toEqual(draft("cursorless"))
    storage.close()
  })

  test("a project keeps only its newest drafts", async () => {
    await using tmp = await tmpdir()
    const storage = createStorage(tmp.path, "test")
    const drafts = createPromptDrafts(storage.storage)
    // savedAt decides eviction, so give each write its own instant.
    const total = MAX_DRAFTS_PER_PROJECT + 5
    for (let index = 0; index < total; index++) {
      setSystemTime(new Date(start + index * 1000))
      await drafts.write("/project", `ses_${index}`, draft(`draft ${index}`))
    }

    const tabs = Object.keys((await file(tmp.path)).projects["/project"])
    expect(tabs).toHaveLength(MAX_DRAFTS_PER_PROJECT)
    expect(tabs).toContain(`ses_${total - 1}`)
    expect(tabs).not.toContain(`ses_${total - MAX_DRAFTS_PER_PROJECT - 1}`)
    expect(drafts.read("/project", `ses_${total - 1}`)?.prompt.text).toBe(`draft ${total - 1}`)
    storage.close()
  })
})
