import { describe, expect, test } from "bun:test"
import { measureEditText } from "@opentui/core"
import { mkdir, readdir, rm, stat, utimes } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { readKeptAttachments } from "../../src/component/prompt/local-attachment"
import {
  appendPrompt,
  isDuplicateEntry,
  keepPromptMedia,
  MAX_HISTORY_ENTRIES,
  parsePromptHistory,
  persistablePrompt,
  promptMediaDirectory,
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

  test("marks a file uri read back without a path or an @ mention as recalled", () => {
    const restored = { uri: "file:///srv/shot.png", mention: { start: 0, end: 9, text: "[Image 1]" } }
    const others = [
      { uri: "file:///srv/a.ts", mention: { start: 10, end: 15, text: "@a.ts" } },
      { uri: "file:///tmp/clip.mp4", path: "/tmp/clip.mp4" },
      { uri: "data:image/png;base64,AAA" },
    ]
    expect(parsePromptHistory(JSON.stringify(entry("[Image 1] @a.ts", [restored, ...others])))).toEqual([
      entry("[Image 1] @a.ts", [{ ...restored, recalled: true }, ...others]),
    ])
  })

  test("keeps a video's local file instead of its bytes, and gives a video of any type without one a file", async () => {
    await using tmp = await tmpdir()
    const image = { uri: "data:image/png;base64,AAAA", path: "/tmp/shot.png" }
    const video = { uri: "data:video/mp4;base64,BBBB", path: "/tmp/my clip.mp4" }
    const restored = ["data:video/mp4;base64,CCCC", "data:video/webm;base64,DDDD", "data:video/x-matroska;base64,CCCC"]
    const files = [image, video, ...restored.map((uri) => ({ uri }))]
    const persisted = persistablePrompt(entry("media", files), tmp.path).files!

    expect(persisted.slice(0, 2)).toEqual([image, { ...video, uri: pathToFileURL(video.path).href }])
    for (const file of persisted.slice(2)) {
      expect(path.dirname(file.path!)).toBe(path.join(tmp.path, "prompt-media"))
      expect(file.uri).toBe(pathToFileURL(file.path!).href)
    }
    // Sending reads each file back as the type it was restored with.
    expect((await readKeptAttachments(persisted.slice(2), true)).files.map((file) => file.uri)).toEqual(restored)
  })

  test("persisting a kept video again restarts its grace window", async () => {
    await using tmp = await tmpdir()
    const prompt = entry("media", [{ uri: "data:video/mp4;base64,AAAA" }])
    const file = persistablePrompt(prompt, tmp.path).files![0]!.path!
    const day = new Date(Date.now() - 25 * 60 * 60 * 1000)
    await utimes(file, day, day)

    // As a draft persisted again does before its entry is written.
    expect(persistablePrompt(prompt, tmp.path).files![0]!.path).toBe(file)
    await prunePromptMedia(tmp.path)
    expect(await Bun.file(file).exists()).toBe(true)
  })

  test("keeps a video's bytes and leaves no temporary file when its file cannot be written", async () => {
    await using tmp = await tmpdir()
    const uri = "data:video/mp4;base64,BBBB"
    // A directory under the video's name makes the final rename fail after the temporary file is written.
    const name = Bun.SHA256.hash(Buffer.from("BBBB", "base64"), "hex") + ".mp4"
    await mkdir(path.join(promptMediaDirectory(tmp.path), name), { recursive: true })

    expect(persistablePrompt(entry("media", [{ uri }]), tmp.path).files).toEqual([{ uri }])
    const deadline = Date.now() + 2_000
    while ((await readdir(promptMediaDirectory(tmp.path))).length > 1 && Date.now() < deadline) await Bun.sleep(5)
    expect(await readdir(promptMediaDirectory(tmp.path))).toEqual([name])
  })

  test("prunes kept videos that no history or stash entry names, once they are past the grace window", async () => {
    await using tmp = await tmpdir()
    const kept = (data: string) =>
      persistablePrompt(entry("media", [{ uri: `data:video/mp4;base64,${data}` }]), tmp.path)
    const [history, stash, orphan, fresh] = ["AAAA", "BBBB", "CCCC", "DDDD"].map(kept)
    const leftover = path.join(promptMediaDirectory(tmp.path), "partial.mp4.0.tmp")
    await Bun.write(leftover, "")
    const day = new Date(Date.now() - 25 * 60 * 60 * 1000)
    for (const file of [history!, stash!, orphan!].map((prompt) => prompt.files![0]!.path!).concat(leftover))
      await utimes(file, day, day)
    await Bun.write(path.join(tmp.path, "prompt-history.jsonl"), JSON.stringify(history) + "\n")
    await Bun.write(path.join(tmp.path, "prompt-stash.jsonl"), JSON.stringify({ prompt: stash, timestamp: 1 }) + "\n")

    await prunePromptMedia(tmp.path)
    const names = (prompts: PromptInfo[]) => prompts.map((prompt) => path.basename(prompt.files![0]!.path!)).toSorted()
    expect((await readdir(promptMediaDirectory(tmp.path))).toSorted()).toEqual(names([history!, stash!, fresh!]))

    // Nothing goes when an entry file cannot be read: it may name any of them.
    await rm(path.join(tmp.path, "prompt-stash.jsonl"))
    await mkdir(path.join(tmp.path, "prompt-stash.jsonl"))
    await prunePromptMedia(tmp.path)
    expect((await readdir(promptMediaDirectory(tmp.path))).toSorted()).toEqual(names([history!, stash!, fresh!]))
  })

  test("restarts the grace window of only the kept videos a prompt names", async () => {
    await using tmp = await tmpdir()
    const kept = path.join(promptMediaDirectory(tmp.path), "0d".repeat(32) + ".mp4")
    const own = path.join(tmp.path, "clip.mp4")
    const day = new Date(Date.now() - 25 * 60 * 60 * 1000)
    for (const file of [kept, own]) {
      await Bun.write(file, "")
      await utimes(file, day, day)
    }
    keepPromptMedia(
      entry(
        "clips",
        [kept, own].map((file) => ({ uri: pathToFileURL(file).href, path: file })),
      ),
      tmp.path,
    )
    expect(Date.now() - (await stat(kept)).mtimeMs).toBeLessThan(60_000)
    expect((await stat(own)).mtimeMs).toBe(day.getTime())
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
