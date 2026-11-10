import { ImageRenderable, InputRenderable, TextareaRenderable, VideoRenderable } from "@opentui/core"
import { expect, test } from "bun:test"
import { copyFile, rm, utimes } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { appendToSessionPrompt, takeDraft } from "../src/component/prompt/draft-stash"
import { MAX_LOCAL_VIDEO_BYTES } from "../src/component/prompt/local-attachment"
import type { Config } from "../src/config"
import { promptMediaDirectory, prunePromptMedia, type PromptFile } from "../src/prompt/history"
import { appendText } from "../src/util/persistence"
import { createAppFixture } from "./fixture/app"
import { tmpdir } from "./fixture/fixture"
import { waitForHighlightedFrame } from "./fixture/frame"
import { descendants, imageFixture, videoFixture } from "./fixture/media"
import { directory, json } from "./fixture/tui-client"

const videoBase64 = Buffer.from(await Bun.file(videoFixture).arrayBuffer()).toString("base64")
const imageBase64 = Buffer.from(await Bun.file(imageFixture).arrayBuffer()).toString("base64")
const videoURI = `data:video/mp4;base64,${videoBase64}`
const imageURI = `data:image/png;base64,${imageBase64}`
const richMedia = { experimental: { rich_media: true } }
const time = { created: 1, completed: 2 }
const location = { directory, project: { id: "proj_test", directory, canonical: directory } }
// The revert hides the newest message.
const session = {
  id: "ses_inline_media",
  title: "Inline media",
  projectID: "proj_test",
  location: { directory },
  cost: 0,
  agent: "build",
  model: { providerID: "demo", id: "model" },
  time: { created: 0, updated: 0 },
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  revert: { messageID: "msg_reverted" },
}
const inline = (data: string, mime: string, name: string) => ({ data, mime, source: { type: "inline" }, name })
// At 100 columns the tool's first three files fit before "+3 more".
const shots = [imageURI, videoURI, imageURI, videoURI, imageURI, videoURI].map((uri, index) => ({
  type: "file",
  uri,
  mime: uri.startsWith("data:video/") ? "video/mp4" : "image/png",
  name: `shot-${index}`,
}))
// A remote server lists `out` once for both of its files; only the file counts. A local server has only the fixture.
// The last is outside the session's directory.
const named = [`${directory}/out/demo.mp4`, "out/gone.mp4", videoFixture, "/elsewhere/clip.mp4"]
const listing = [
  { path: "out/demo.mp4.part", type: "file" },
  { path: "out/demo.mp4", type: "file" },
  { path: "out/gone.mp4", type: "directory" },
]
// Listed newest first, as the server pages them.
const messages = [
  { type: "user", id: "msg_reverted", text: "Reverted", files: [inline(imageBase64, "image/png", "gone.png")], time },
  {
    type: "synthetic",
    id: "msg_generated",
    time: { created: 3 },
    description: "Image generation",
    text: `Image request finished. Saved image: ${directory}/generated/image.png (provider/model).`,
    metadata: { source: "experimental_image_generate", state: "completed", path: `${directory}/generated/image` },
  },
  {
    type: "assistant",
    id: "msg_reply",
    agent: "build",
    model: { providerID: "demo", id: "model" },
    time,
    content: [
      { type: "text", text: `Rendered ${named.map((file) => `\`${file}\``).join(" and ")}.` },
      {
        type: "tool",
        id: "call_shots",
        name: "screenshot",
        time,
        state: { status: "completed", input: {}, content: [{ type: "text", text: "captured" }, ...shots] },
      },
    ],
  },
  { type: "user", id: "msg_ask", text: "What happens", files: [inline(videoBase64, "video/mp4", "clip.mp4")], time },
]
const queued = {
  id: "msg_queued",
  sessionID: session.id,
  type: "user",
  delivery: "queue",
  time: { created: 5 },
  payload: { text: "Queued", files: [inline(imageBase64, "image/png", "queued.png")] },
}
// The transcript shows the user's video, the named video, the tool's first three files, and the generated image. The
// viewer shows each file once: the tool's files repeat one image and the user's video, so it holds the video, the named
// video, the image and the generated image, and leaves out the reverted and queued messages' images.
const transcriptTiles = { videos: 3, images: 3 }

type Stashed = { text: string; files: PromptFile[] }
const video = (start: number) => ({ start, end: start + 9, text: "[Video 1]" })

/** Opens the session with `stash` in the prompt stash under `state`, oldest first. */
async function openSession(config: Config.Info, options: { state: string; localServer?: boolean; stash?: Stashed[] }) {
  takeDraft(session.id)
  const stash = path.join(options.state, "prompt-stash.jsonl")
  const entries = (options.stash ?? []).map((prompt) => ({
    prompt: { ...prompt, agents: [], skills: [], pasted: [] },
    timestamp: 1,
  }))
  if (entries.length) await Bun.write(stash, entries.map((entry) => JSON.stringify(entry) + "\n").join(""))
  const listed: string[] = []
  const prompts: PromiseWithResolvers<{ files?: { uri: string }[] }>[] = []
  const prompt = (index: number) => (prompts[index] ??= Promise.withResolvers())
  let received = 0
  const setup = await createAppFixture({
    width: 100,
    height: 60,
    state: options.state,
    localServer: options.localServer,
    args: { sessionID: session.id },
    config: { animations: false, tabs: { enabled: false }, ...config },
    fetch: async (url, request) => {
      const rest = url.pathname.replace(/^\/api\/(experimental\/)?session\/ses_inline_media/, "")
      if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
      if (url.pathname === "/api/fs/read/generated/image.png") return new Response(Bun.file(imageFixture))
      if (url.pathname === "/api/fs/read/out/demo.mp4") return new Response(Bun.file(videoFixture))
      // The startup listing has no path.
      if (url.pathname === "/api/fs/list" && url.searchParams.has("path")) {
        listed.push(url.searchParams.get("path")!)
        return json({ location, data: listing })
      }
      if (url.pathname === "/api/agent")
        return json({ location, data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }] })
      if (url.pathname === "/api/fs/find") return json({ location, data: [] })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "demo", name: "Demo" }] })
      if (url.pathname === "/api/model")
        return json({ location, data: [{ id: "model", providerID: "demo", name: "Demo", variants: [] }] })
      if (rest === "/message") return json({ data: messages, cursor: {} })
      if (rest === "") return json({ data: session })
      if (rest === "/inbox") return json({ data: [queued] })
      if (rest === "/permission") return json({ data: [] })
      if (rest === "/revert/commit") return new Response(null, { status: 204 })
      if (rest !== "/prompt") return undefined
      const body = await request.json()
      prompt(received++).resolve(body)
      return json({ data: { id: body.id, sessionID: session.id, type: "user", time, payload: { text: body.text } } })
    },
  })
  await setup.ready
  await waitForHighlightedFrame(setup, (frame) => frame.includes("What happens") && frame.includes("Rendered"))
  const nodes = () => descendants(setup.renderer.root)
  const history = path.join(options.state, "prompt-history.jsonl")
  return Object.assign(setup, {
    stash,
    listed,
    /** The body of the `index`th prompt sent. */
    sent: (index: number) => prompt(index).promise,
    videos: () => nodes().filter((node) => node instanceof VideoRenderable),
    images: () => nodes().filter((node) => node instanceof ImageRenderable),
    textarea: () => nodes().find((node) => node instanceof TextareaRenderable),
    composer: () => nodes().find((node) => node instanceof TextareaRenderable)?.plainText ?? "",
    /** The newest history entry, once the writes already queued for the file are done. */
    async saved() {
      await appendText(history, "")
      return JSON.parse((await Bun.file(history).text()).trim().split("\n").at(-1)!)
    },
    // Tiles open and decode, and pastes and checks resolve, on the wall clock: look after each frame, up to a deadline.
    async until(condition: () => boolean) {
      const deadline = Date.now() + 5_000
      while (!condition() && Date.now() < deadline)
        await new Promise((resolve) => setup.renderer.once("frame", resolve))
      expect(condition()).toBe(true)
    },
    async click(text: string) {
      const lines = setup.captureCharFrame().split("\n")
      const y = lines.findIndex((line) => line.includes(text))
      await setup.mockMouse.click(lines[y]!.indexOf(text) + 1, y)
    },
    async search(text: string) {
      setup.mockInput.pressKey("p", { ctrl: true })
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable instanceof InputRenderable)
      await setup.mockInput.typeText(text)
      await setup.waitForFrame((frame) => frame.includes(text))
    },
    async palette(command: string) {
      await this.search(command)
      setup.mockInput.pressEnter()
    },
  })
}

type App = Awaited<ReturnType<typeof openSession>>

/** Opens the named video's tile, which sits right under the text naming it, above the tool's tiles. */
async function openNamedVideo(app: App, name: string) {
  const y = app
    .captureCharFrame()
    .split("\n")
    .findIndex((line) => line.includes("Rendered"))
  const tile = app
    .videos()
    .filter((tile) => tile.y > y)
    .toSorted((a, b) => a.y - b.y)[0]!
  await app.mockMouse.click(tile.x + 1, tile.y + 1)
  await app.waitForFrame((frame) => frame.includes("Video 2 of 4"))
  await expectViewerShows(app, name)
  app.mockInput.pressEscape()
  await app.waitForFrame((frame) => !frame.includes("Video 2 of 4"))
}

/** The viewer's details name `name`; closing them leaves the viewer open. */
async function expectViewerShows(app: App, name: string) {
  app.mockInput.pressKey("i")
  await app.waitForFrame((frame) => frame.includes(`Name        ${name}`))
  app.mockInput.pressEscape()
  await app.waitForFrame((frame) => !frame.includes(`Name        ${name}`))
}

test("against a remote server, media shows as tiles that open the viewer, and a pasted video drafts as its path", async () => {
  await using temporary = await tmpdir()
  // As a remote server's restore leaves it: a file uri on the server's machine, though this one has a file there too.
  const held = path.join(temporary.path, "held.mp4")
  await copyFile(videoFixture, held)
  const remote = { uri: pathToFileURL(held).href, name: "held.mp4", mention: video(5) }
  await using app = await openSession(richMedia, {
    state: temporary.path,
    stash: [{ text: "Look [Video 1]", files: [remote] }],
  })
  await app.until(
    () => app.videos().length === transcriptTiles.videos && app.images().length === transcriptTiles.images,
  )
  const transcript = app.videos()
  expect(transcript.every((tile) => tile.paused && !tile.audio)).toBe(true)
  await openNamedVideo(app, "demo.mp4")
  expect(app.listed).toEqual(["out"])

  // "+3 more" opens the first hidden tool file, which is the user's video again, where it first appears. The open
  // viewer keeps keys from the prompt.
  await app.click("+3 more")
  await app.waitForFrame((frame) => frame.includes("Video 1 of 4"))
  await expectViewerShows(app, "clip.mp4")
  await app.mockInput.typeText("abc")
  expect(app.composer()).toBe("")
  app.mockInput.pressEscape()
  await app.waitForFrame((frame) => !frame.includes("Video 1 of 4"))

  // The palette opens it at the newest item. The palette gives focus back on a timer, which the prompt must refuse.
  await app.palette("View media")
  await app.waitForFrame((frame) => frame.includes("4 of 4"))
  expect(app.textarea()?.focusable).toBe(false)
  app.mockInput.pressEscape()
  await app.waitForFrame((frame) => !frame.includes("4 of 4"))

  // The draft plays the pasted file itself, which pasting did not read, and attaching an image keeps its tile.
  app.mockInput.pasteBracketedText(videoFixture)
  await app.until(() => app.videos().length === transcriptTiles.videos + 1)
  expect(app.composer()).toContain("[Video 1]")
  const draft = app.videos().find((tile) => !transcript.includes(tile))!
  expect(draft.source).toBe(videoFixture)
  app.mockInput.pasteBracketedText(imageFixture)
  await app.until(() => app.images().length === transcriptTiles.images + 1)
  expect(app.composer()).toContain("[Image 1]")
  expect(app.videos()).toContain(draft)

  // History keeps the video's path, not its bytes, and sending the recalled prompt reads them again.
  app.mockInput.pressKey("c", { ctrl: true })
  const saved = JSON.stringify(await app.saved())
  expect(saved).toContain(JSON.stringify(pathToFileURL(videoFixture).href))
  expect(saved).not.toContain("data:video")
  app.mockInput.pressArrow("up")
  await app.waitForFrame(() => app.composer().includes("[Video 1]"))
  app.mockInput.pressEnter()
  expect((await app.sent(0)).files?.map((file) => file.uri)).toEqual([videoURI, imageURI])

  // The sent message adds its video without rebuilding the tiles still on screen. A tile it scrolls out of view closes
  // its player, and at most four players stay open.
  await app.until(() => app.videos().some((tile) => !transcript.includes(tile) && tile !== draft))
  expect(app.videos().filter((tile) => transcript.includes(tile)).length).toBeGreaterThan(0)
  expect(app.videos().length).toBeLessThanOrEqual(4)

  // A video over the size core sends inline pastes as its path, with a warning.
  const large = path.join(temporary.path, "large.mp4")
  await Bun.write(large, new Uint8Array(MAX_LOCAL_VIDEO_BYTES + 1))
  app.mockInput.pasteBracketedText(large)
  await app.until(() => app.captureCharFrame().includes("large.mp4 is over the attachment size limit"))
  expect(app.composer()).toBe(large)
  app.mockInput.pressKey("c", { ctrl: true })

  // The stashed file video gets no tile: the viewer opens on the image pasted after it, as the draft's only item.
  await app.palette("Stash pop")
  await app.waitForFrame(() => app.composer() === "Look [Video 1]")
  app.mockInput.pasteBracketedText(imageFixture)
  await app.until(() => app.composer().includes("[Image 1]"))
  await app.palette("View media attachments")
  await app.waitForFrame((frame) => frame.includes("Image 1 of 1"))
  app.mockInput.pressEscape()

  // Nor does the server get the uri, which would name this terminal's file.
  app.mockInput.pressEnter()
  await app.waitForFrame((frame) => frame.includes("Could not read held.mp4 again"))
  expect((await app.sent(1)).files?.map((file) => file.uri)).toEqual([imageURI])
})

test("against a local server, a restored prompt's files show as tiles, and a video gone by sending is left out", async () => {
  await using temporary = await tmpdir()
  const held = path.join(temporary.path, "held.mp4")
  const image = path.join(temporary.path, "held.png")
  const mentioned = path.join(temporary.path, "seen.mp4")
  await Promise.all([copyFile(videoFixture, held), copyFile(imageFixture, image), copyFile(videoFixture, mentioned)])
  const files = [
    { uri: pathToFileURL(held).href, name: "held.mp4", mention: video(5) },
    { uri: pathToFileURL(mentioned).href, name: "seen.mp4", mention: { start: 15, end: 24, text: "@seen.mp4" } },
    { uri: pathToFileURL(image).href, name: "held.png", mention: { start: 25, end: 34, text: "[Image 1]" } },
  ]
  const text = "Look [Video 1] @seen.mp4 [Image 1]"
  await using app = await openSession(richMedia, { state: temporary.path, localServer: true, stash: [{ text, files }] })
  await app.until(() => app.videos().length === transcriptTiles.videos)
  await openNamedVideo(app, path.basename(videoFixture))
  expect(app.listed).toEqual([])

  await app.palette("Stash pop")
  await app.waitForFrame(() => app.composer() === text)
  await app.until(
    () => app.videos().length === transcriptTiles.videos + 2 && app.images().length === transcriptTiles.images + 1,
  )

  // The server reads the image and the `@` mention itself; the video is read again here, and it is gone.
  await rm(held)
  app.mockInput.pressEnter()
  await app.waitForFrame((frame) => frame.includes("Could not read held.mp4 again"))
  expect((await app.sent(0)).files?.map((file) => file.uri)).toEqual([
    pathToFileURL(mentioned).href,
    pathToFileURL(image).href,
  ])
})

test("with rich media off, the old image previews stay, and restored videos still reach history as files", async () => {
  await using temporary = await tmpdir()
  // A video history or the stash kept a day ago, which only a stash entry still names.
  const kept = path.join(promptMediaDirectory(temporary.path), "0c".repeat(32) + ".mp4")
  await Bun.write(kept, Bun.file(videoFixture))
  const day = new Date(Date.now() - 25 * 60 * 60 * 1000)
  await utimes(kept, day, day)
  // Undo, revert, and fork restore a sent video as its bytes, as the newer entry has it.
  const restored = { text: "Look [Video 1]", files: [{ uri: videoURI, mention: video(5) }] }
  const stash = [{ text: "Keep [Video 1]", files: [{ uri: pathToFileURL(kept).href, path: kept, mention: video(5) }] }]
  await using app = await openSession(
    { session: { image_preview: true }, prompt: { image_preview: true } },
    { state: temporary.path, localServer: true, stash: [...stash, restored] },
  )

  // The previews show without the video tiles' strip and its "+3 more".
  await app.until(() => app.images().length === transcriptTiles.images)
  await app.renderOnce()
  expect(app.captureCharFrame()).not.toContain("more")
  expect(app.videos()).toEqual([])

  // Nor is the transcript's media a gallery, which would also look for the files replies name: the palette offers no
  // "View media". Settings join the commands once the search applies.
  await app.search("View media")
  const palette = await app.waitForFrame((frame) => frame.includes("Settings ·"))
  expect(palette.match(/View media/g)).toEqual(["View media"])
  app.mockInput.pressEscape()

  // A pasted video path stays text.
  app.mockInput.pasteBracketedText(videoFixture)
  await app.until(() => app.composer().includes(videoFixture))
  expect(app.composer()).not.toContain("[Video")
  app.mockInput.pressKey("c", { ctrl: true })

  // History keeps a restored video as a file straight after the restore, and sending reads its bytes again without
  // naming the kept file to the model.
  await app.palette("Stash pop")
  await app.waitForFrame(() => app.composer() === restored.text)
  app.mockInput.pressKey("c", { ctrl: true })
  const file = (await app.saved()).files[0]
  expect(file.uri).toBe(pathToFileURL(file.path).href)
  expect(path.dirname(file.path)).toBe(promptMediaDirectory(temporary.path))
  expect(Buffer.from(await Bun.file(file.path).arrayBuffer()).toString("base64")).toBe(videoBase64)
  app.mockInput.pressArrow("up")
  await app.waitForFrame(() => app.composer() === restored.text)
  app.mockInput.pressEnter()
  expect((await app.sent(0)).files).toEqual(restored.files)

  // A local server's restored file video of any type gets its path at once. The server reads the image itself.
  const webm = path.join(temporary.path, "held.webm")
  const png = path.join(temporary.path, "held.png")
  await Promise.all([copyFile(videoFixture, webm), copyFile(imageFixture, png)])
  const files = [
    { uri: pathToFileURL(webm).href, name: "held.webm", mention: video(5) },
    { uri: pathToFileURL(png).href, name: "held.png", mention: { start: 15, end: 24, text: "[Image 1]" } },
  ]
  await app.until(() => app.composer() === "")
  const prompt = { text: "Look [Video 1] [Image 1]", files, agents: [], skills: [], pasted: [] }
  const composer = appendToSessionPrompt(session.id, prompt, app.renderer.widthMethod)
  const localized = [{ ...files[0], path: webm }, files[1]]
  expect(composer?.current.files).toEqual(localized)
  app.mockInput.pressKey("c", { ctrl: true })
  expect((await app.saved()).files).toEqual(localized)

  // Popping the entry that names the old kept video restarts its grace window, so pruning keeps it.
  await app.palette("Stash pop")
  await app.waitForFrame(() => app.composer() === "Keep [Video 1]")
  await appendText(app.stash, "")
  await prunePromptMedia(temporary.path)
  expect(await Bun.file(kept).exists()).toBe(true)
})
