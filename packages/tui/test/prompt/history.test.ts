import { describe, expect, test } from "bun:test"
import { measureEditText } from "@opentui/core"
import { mkdir, readdir, rm, stat, utimes } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { promptFilesForServer, readKeptAttachments } from "../../src/component/prompt/local-attachment"
import {
  appendPrompt,
  isDuplicateEntry,
  keepPromptMedia,
  MAX_HISTORY_ENTRIES,
  parsePromptHistory,
  persistablePrompt,
  promptMediaDirectory,
  promptServer,
  prunePromptMedia,
  type PromptInfo,
} from "../../src/prompt/history"
import { tmpdir } from "../fixture/fixture"

const entry = (text: string, files: PromptInfo["files"] = []): PromptInfo => ({
  text,
  files,
  agents: [],
  pasted: [],
})

describe("prompt history", () => {
  test("recovers valid JSONL entries around corruption", () => {
    const control = entry("a\u001b[31mb\fc\0d\r\n")
    expect(parsePromptHistory(`${JSON.stringify(control)}\nnot-json\n${JSON.stringify(entry("two"))}\n`)).toEqual([
      control,
      entry("two"),
    ])
  })

  test("ignores the legacy parts shape", () => {
    expect(parsePromptHistory(JSON.stringify({ input: "old", parts: [] }))).toEqual([])
  })

  test("retains only the newest entries", () => {
    const input = Array.from({ length: MAX_HISTORY_ENTRIES + 5 }, (_, index) =>
      JSON.stringify(entry(String(index))),
    ).join("\n")
    const result = parsePromptHistory(input)
    expect(result).toHaveLength(MAX_HISTORY_ENTRIES)
    expect(result[0]?.text).toBe("5")
  })

  test("dedupes only identical consecutive entries", () => {
    expect(isDuplicateEntry(undefined, entry("hello"))).toBe(false)
    expect(isDuplicateEntry(entry("hello"), entry("hello"))).toBe(true)
    expect(isDuplicateEntry(entry("foo"), entry("bar"))).toBe(false)
    expect(isDuplicateEntry({ ...entry("ls"), mode: "normal" }, { ...entry("ls"), mode: "shell" })).toBe(false)
  })

  test("does not dedupe entries with different attachments", () => {
    const a = entry("describe this", [{ name: "a.png", uri: "data:image/png;base64,AAA" }])
    const b = entry("describe this", [{ name: "b.png", uri: "data:image/png;base64,BBB" }])
    expect(isDuplicateEntry(a, b)).toBe(false)
  })

  test("preserves duplicate attachment mentions for prompt restoration", () => {
    const value = entry("[Image 1] [Image 1]", [
      {
        name: "clipboard",
        uri: "data:image/png;base64,AAA",
        mention: { start: 0, end: 9, text: "[Image 1]" },
      },
      {
        name: "clipboard",
        uri: "data:image/png;base64,AAA",
        mention: { start: 10, end: 19, text: "[Image 1]" },
      },
    ])

    expect(parsePromptHistory(JSON.stringify(value))).toEqual([value])
  })

  test("records the server a file uri without a path or an @ mention came from, and sends it only to that server", async () => {
    const server = promptServer("https://devbox.example:4096/base")
    const restored = { uri: "file:///srv/shot.png", mention: { start: 0, end: 9, text: "[Image 1]" } }
    const recalled = { ...restored, uri: "file:///srv/old.png", server: "https://other.example" }
    const others = [
      { uri: "file:///srv/a.ts", mention: { start: 10, end: 15, text: "@a.ts" } },
      { uri: "file:///tmp/clip.mp4", path: "/tmp/clip.mp4" },
      { uri: "data:image/png;base64,AAA" },
    ]
    const saved = JSON.stringify(
      persistablePrompt(entry("[Image 1] @a.ts", [restored, recalled, ...others]), "", server),
    )
    const [read] = parsePromptHistory(saved)
    expect(read).toEqual(entry("[Image 1] @a.ts", [{ ...restored, server }, recalled, ...others]))
    // An entry written before the server was recorded names a file on an unknown machine.
    expect(parsePromptHistory(JSON.stringify(entry("[Image 1]", [restored])))[0]!.files).toEqual([
      { ...restored, server: "" },
    ])

    // After a restart against the same remote server it gets its own files back, and never another server's.
    const files = read!.files!.slice(0, 3)
    expect(await readKeptAttachments(files, false, "https://devbox.example:4096")).toEqual({
      files: [{ ...restored, server }, others[0]!],
      unreadable: ["old.png"],
    })
    expect((await readKeptAttachments(files, false, "https://other.example")).unreadable).toEqual(["shot.png"])
    expect(promptFilesForServer([{ ...restored, server }], false, "")).toEqual([restored])
  })

  test("keeps a video's local file, or a file written for its bytes, and keeps the bytes when that write fails", async () => {
    await using tmp = await tmpdir()
    const image = { uri: "data:image/png;base64,AAAA", path: "/tmp/shot.png" }
    const video = { uri: "data:video/mp4;base64,BBBB", path: "/tmp/my clip.mp4" }
    const restored = ["data:video/mp4;base64,CCCC", "data:video/webm;base64,DDDD", "data:video/x-matroska;base64,CCCC"]
    const files = [image, video, ...restored.map((uri) => ({ uri }))]
    const persisted = persistablePrompt(entry("media", files), tmp.path, "").files!

    expect(persisted.slice(0, 2)).toEqual([image, { ...video, uri: pathToFileURL(video.path).href }])
    for (const file of persisted.slice(2)) {
      expect(path.dirname(file.path!)).toBe(promptMediaDirectory(tmp.path))
      expect(file.uri).toBe(pathToFileURL(file.path!).href)
    }
    // Sending reads each file back as the type it was restored with.
    expect((await readKeptAttachments(persisted.slice(2), true, "")).files.map((file) => file.uri)).toEqual(restored)

    // A directory under the video's name makes the final rename fail.
    const name = Bun.SHA256.hash(Buffer.from("EEEE", "base64"), "hex") + ".mp4"
    await mkdir(path.join(promptMediaDirectory(tmp.path), name))
    const unwritable = [{ uri: "data:video/mp4;base64,EEEE" }]
    expect(persistablePrompt(entry("media", unwritable), tmp.path, "").files).toEqual(unwritable)
  })

  test("restarts the grace window of a kept video persisted again or put back in the composer, and of no other file", async () => {
    await using tmp = await tmpdir()
    const prompt = entry("media", [{ uri: "data:video/mp4;base64,AAAA" }])
    const kept = persistablePrompt(prompt, tmp.path, "").files![0]!.path!
    const own = path.join(tmp.path, "clip.mp4")
    await Bun.write(own, "")
    const fresh = async (file: string) => Date.now() - (await stat(file)).mtimeMs < 60_000

    // As a draft persisted again does before its entry is written.
    await age(kept)
    expect(persistablePrompt(prompt, tmp.path, "").files![0]!.path).toBe(kept)
    expect(await fresh(kept)).toBe(true)

    await age(kept, own)
    keepPromptMedia(
      entry(
        "clips",
        [kept, own].map((file) => ({ uri: pathToFileURL(file).href, path: file })),
      ),
      tmp.path,
    )
    expect(await fresh(kept)).toBe(true)
    expect(await fresh(own)).toBe(false)
  })

  test("prunes kept videos that no history or stash entry names, once they are past the grace window", async () => {
    await using tmp = await tmpdir()
    const kept = (data: string) =>
      persistablePrompt(entry("media", [{ uri: `data:video/mp4;base64,${data}` }]), tmp.path, "")
    const [history, stash, orphan, fresh] = ["AAAA", "BBBB", "CCCC", "DDDD"].map(kept)
    const file = (prompt: PromptInfo) => prompt.files![0]!.path!
    const leftover = path.join(promptMediaDirectory(tmp.path), "partial.mp4.0.tmp")
    await Bun.write(leftover, "")
    await age(file(history!), file(stash!), file(orphan!), leftover)
    const stashFile = path.join(tmp.path, "prompt-stash.jsonl")
    await Bun.write(path.join(tmp.path, "prompt-history.jsonl"), JSON.stringify(history) + "\n")
    await Bun.write(stashFile, JSON.stringify({ prompt: stash, timestamp: 1 }) + "\n")
    const remaining = [history!, stash!, fresh!].map((prompt) => path.basename(file(prompt))).toSorted()
    const listed = async () => (await readdir(promptMediaDirectory(tmp.path))).toSorted()

    await prunePromptMedia(tmp.path)
    expect(await listed()).toEqual(remaining)

    // Nothing goes when an entry file cannot be read: it may name any of them.
    await rm(stashFile)
    await mkdir(stashFile)
    await prunePromptMedia(tmp.path)
    expect(await listed()).toEqual(remaining)
  })

  test.each(["wcwidth", "unicode"] as const)("appends a prompt and shifts ranges by the %s offset", (widthMethod) => {
    const output = appendPrompt(
      { ...entry("日本👨‍👩‍👧\t\f"), pasted: [{ text: "long", source: { start: 0, end: 4, text: "日本" } }] },
      {
        ...entry("@a.ts [Pasted]", [{ uri: "file:///a.ts", mention: { start: 0, end: 5, text: "@a.ts" } }]),
        agents: [{ name: "build" }],
        pasted: [{ text: "more", source: { start: 6, end: 14, text: "[Pasted]" } }],
      },
      widthMethod,
    )

    const offset = measureEditText("日本👨‍👩‍👧\t\f\n\n", { widthMethod })
    expect(output).toEqual({
      text: "日本👨‍👩‍👧\t\f\n\n@a.ts [Pasted]",
      files: [{ uri: "file:///a.ts", mention: { start: offset, end: offset + 5, text: "@a.ts" } }],
      agents: [{ name: "build", mention: undefined }],
      skills: [],
      pasted: [
        { text: "long", source: { start: 0, end: 4, text: "日本" } },
        { text: "more", source: { start: offset + 6, end: offset + 14, text: "[Pasted]" } },
      ],
    })
    expect(appendPrompt(entry(""), entry("next"), widthMethod).text).toBe("next")
  })
})

// Past the day-long grace window of kept videos.
async function age(...files: string[]) {
  const day = new Date(Date.now() - 25 * 60 * 60 * 1000)
  for (const file of files) await utimes(file, day, day)
}
