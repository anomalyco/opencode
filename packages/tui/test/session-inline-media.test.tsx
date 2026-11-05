import { ImageRenderable, InputRenderable, TextareaRenderable, VideoRenderable } from "@opentui/core"
import { expect, test } from "bun:test"
import { copyFile, rm, utimes } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { appendToSessionPrompt, takeDraft } from "../src/component/prompt/draft-stash"
import { MAX_LOCAL_VIDEO_BYTES } from "../src/component/prompt/local-attachment"
import type { Config } from "../src/config"
import { promptMediaDirectory, prunePromptMedia } from "../src/prompt/history"
import { createAppFixture } from "./fixture/app"
import { tmpdir } from "./fixture/fixture"
import { descendants, imageFixture, videoFixture } from "./fixture/media"
import { directory, json } from "./fixture/tui-client"

const videoBase64 = Buffer.from(await Bun.file(videoFixture).arrayBuffer()).toString("base64")
const imageBase64 = Buffer.from(await Bun.file(imageFixture).arrayBuffer()).toString("base64")
const videoURI = `data:video/mp4;base64,${videoBase64}`
const imageURI = `data:image/png;base64,${imageBase64}`
const richMedia = { experimental: { "rich-media": true } }
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
// Listed newest first, as the server pages them.
const messages = [
  {
    type: "user",
    id: "msg_reverted",
    text: "Reverted",
    files: [inline(imageBase64, "image/png", "gone.png")],
    time,
  },
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
      {
        type: "tool",
        id: "call_shots",
        name: "screenshot",
        time,
        state: { status: "completed", input: {}, content: [{ type: "text", text: "captured" }, ...shots] },
      },
      { type: "text", text: "Captured the frames" },
    ],
  },
  {
    type: "user",
    id: "msg_ask",
    text: "What happens",
    files: [inline(videoBase64, "video/mp4", "clip.mp4")],
    time,
  },
]
const queued = {
  id: "msg_queued",
  sessionID: session.id,
  type: "user",
  delivery: "queue",
  time: { created: 5 },
  payload: { text: "Queued", files: [inline(imageBase64, "image/png", "queued.png")] },
}

async function openSession(config: Config.Info, options: { state?: string; localServer?: boolean } = {}) {
  takeDraft(session.id)
  const prompts: { files?: { uri: string }[] }[] = []
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
      prompts.push(body)
      return json({ data: { id: body.id, sessionID: session.id, type: "user", time, payload: { text: body.text } } })
    },
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("What happens"))
  const nodes = () => descendants(setup.renderer.root)
  return Object.assign(setup, {
    prompts,
    videos: () => nodes().filter((node) => node instanceof VideoRenderable),
    images: () => nodes().filter((node) => node instanceof ImageRenderable),
    composer: () => nodes().find((node) => node instanceof TextareaRenderable)?.plainText ?? "",
    // Video tiles open and decode on the wall clock, so poll between frames.
    async until(condition: () => boolean) {
      const deadline = Date.now() + 5_000
      while (!condition() && Date.now() < deadline) {
        await Bun.sleep(10)
        await setup.renderOnce()
      }
      expect(condition()).toBe(true)
    },
    async palette(command: string) {
      setup.mockInput.pressKey("p", { ctrl: true })
      await setup.waitFor(() => setup.renderer.currentFocusedRenderable instanceof InputRenderable)
      await setup.mockInput.typeText(command)
      await setup.waitForFrame((frame) => frame.includes(command))
      setup.mockInput.pressEnter()
    },
  })
}

// The transcript shows the user's video, the tool's first three files, and the generated image.
const transcriptTiles = { videos: 2, images: 3 }

/** Opens the session with `prompt` in the stash and pops it into the composer. */
async function popStash(state: string, prompt: { text: string; files: unknown[] }, localServer?: boolean) {
  const entry = { prompt: { ...prompt, agents: [], skills: [], pasted: [] }, timestamp: 1 }
  await Bun.write(path.join(state, "prompt-stash.jsonl"), JSON.stringify(entry) + "\n")
  const app = await openSession(richMedia, { state, localServer })
  await app.until(() => app.videos().length === transcriptTiles.videos)
  await app.palette("Stash pop")
  await app.waitForFrame(() => app.composer() === prompt.text)
  return app
}

test("shows the session's media as tiles that open the viewer over the whole gallery", async () => {
  await using app = await openSession(richMedia)
  await app.until(
    () => app.videos().length === transcriptTiles.videos && app.images().length === transcriptTiles.images,
  )
  expect(app.videos().every((video) => video.paused && !video.audio)).toBe(true)

  const lines = app.captureCharFrame().split("\n")
  const y = lines.findIndex((line) => line.includes("+3 more"))
  await app.mockMouse.click(lines[y]!.indexOf("+3 more") + 1, y)
  // The first hidden tool file, after the user's video and the three tiles shown. The 8 items leave out the reverted
  // and queued messages' images.
  await app.waitForFrame((frame) => frame.includes("5 / 8"))

  app.mockInput.pressEscape()
  await app.waitForFrame((frame) => !frame.includes("5 / 8"))
}, 20000)

test("keeps the prompt from taking input while the viewer is open", async () => {
  await using app = await openSession(richMedia)
  await app.palette("View media")
  // Opened from the command palette at the newest item.
  await app.waitForFrame((frame) => frame.includes("8 / 8"))
  const textarea = descendants(app.renderer.root).find((node) => node instanceof TextareaRenderable)
  expect(textarea?.focusable).toBe(false)
  await Bun.sleep(50) // Past the dialog's refocus timer.
  await app.mockInput.typeText("abc")
  app.mockInput.pressEnter()
  app.mockInput.pressEscape()
  await app.waitForFrame((frame) => !frame.includes("8 / 8"))
  expect(app.prompts).toEqual([])
  expect(app.composer()).toBe("")
}, 20000)

test("attaches a pasted video as its path, keeps only the path in history, and sends its bytes again", async () => {
  await using temporary = await tmpdir()
  await using app = await openSession(richMedia, { state: temporary.path })
  await app.until(() => app.videos().length === transcriptTiles.videos)
  const transcript = app.videos()

  app.mockInput.pasteBracketedText(videoFixture)
  await app.waitForFrame(() => app.composer().includes("[Video 1]"))
  await app.until(() => app.videos().length === transcriptTiles.videos + 1)
  const draft = app.videos().find((video) => !transcript.includes(video))!
  // The draft plays the pasted file itself, which pasting did not read.
  expect(draft.source).toBe(videoFixture)

  // Attaching an image keeps the video's tile.
  app.mockInput.pasteBracketedText(imageFixture)
  await app.waitForFrame(() => app.composer().includes("[Image 1]"))
  await app.until(() => app.images().length === transcriptTiles.images + 1)
  expect(app.videos().includes(draft)).toBe(true)

  app.mockInput.pressKey("c", { ctrl: true })
  const history = path.join(temporary.path, "prompt-history.jsonl")
  await app.until(() => Bun.file(history).size > 0)
  const saved = await Bun.file(history).text()
  expect(saved).toContain(JSON.stringify(pathToFileURL(videoFixture).href))
  expect(saved).not.toContain("data:video")

  app.mockInput.pressArrow("up")
  await app.waitForFrame(() => app.composer().includes("[Video 1]"))
  app.mockInput.pressEnter()
  await app.until(() => app.prompts.length === 1)
  expect(app.prompts[0]?.files?.map((file) => file.uri)).toEqual([videoURI, imageURI])

  // The sent message adds its video without rebuilding the tiles still on screen. A tile it scrolls out of view closes
  // its player, and at most four players stay open.
  await app.until(() => app.videos().some((video) => !transcript.includes(video)))
  expect(app.videos().filter((video) => transcript.includes(video)).length).toBeGreaterThan(0)
  expect(app.videos().length).toBeLessThanOrEqual(4)
}, 20000)

test("pastes the path of a video over the size core sends as text, with a warning", async () => {
  await using temporary = await tmpdir()
  const large = path.join(temporary.path, "large.mp4")
  await Bun.write(large, new Uint8Array(MAX_LOCAL_VIDEO_BYTES + 1))
  await using app = await openSession(richMedia)

  app.mockInput.pasteBracketedText(large)
  await app.waitForFrame((frame) => frame.includes("large.mp4 is over the attachment size limit"))
  expect(app.composer()).toBe(large)
}, 20000)

// Undo, revert, and fork restore sent videos as bytes, whether or not the experiment is on.
test("a restored video reaches history as a file at once", async () => {
  await using temporary = await tmpdir()
  const files = [{ uri: videoURI, mention: { start: 5, end: 14, text: "[Video 1]" } }]
  const prompt = { text: "Look [Video 1]", files, agents: [], skills: [], pasted: [] }
  await Bun.write(path.join(temporary.path, "prompt-stash.jsonl"), JSON.stringify({ prompt, timestamp: 1 }) + "\n")
  await using app = await openSession({}, { state: temporary.path, localServer: true })
  await app.palette("Stash pop")
  await app.waitForFrame(() => app.composer() === prompt.text)
  // Straight after the restore, before anything asynchronous could give the video a file.
  app.mockInput.pressKey("c", { ctrl: true })
  const history = path.join(temporary.path, "prompt-history.jsonl")
  await app.until(() => Bun.file(history).size > 0)
  const file = JSON.parse((await Bun.file(history).text()).trim()).files[0]
  expect(file.uri).toBe(pathToFileURL(file.path).href)
  expect(path.extname(file.path)).toBe(".mp4")
  expect(Buffer.from(await Bun.file(file.path).arrayBuffer()).toString("base64")).toBe(videoBase64)

  // Sent again, even to a local server, the kept file is no source the model should hear about.
  app.mockInput.pressArrow("up")
  await app.waitForFrame(() => app.composer() === prompt.text)
  app.mockInput.pressEnter()
  await app.until(() => app.prompts.length === 1)
  expect(app.prompts[0]?.files).toEqual(files)
}, 20000)

test("a stash pop keeps an old kept video its prompt names from being pruned", async () => {
  await using temporary = await tmpdir()
  const kept = path.join(promptMediaDirectory(temporary.path), "0c".repeat(32) + ".mp4")
  await Bun.write(kept, Bun.file(videoFixture))
  const day = new Date(Date.now() - 25 * 60 * 60 * 1000)
  await utimes(kept, day, day)
  const files = [{ uri: pathToFileURL(kept).href, path: kept, mention: { start: 5, end: 14, text: "[Video 1]" } }]
  const prompt = { text: "Look [Video 1]", files, agents: [], skills: [], pasted: [] }
  const stash = path.join(temporary.path, "prompt-stash.jsonl")
  await Bun.write(stash, JSON.stringify({ prompt, timestamp: 1 }) + "\n")
  await using app = await openSession({}, { state: temporary.path })
  await app.palette("Stash pop")
  await app.waitForFrame(() => app.composer() === prompt.text)

  // Once the stash no longer names it, only the draft holds it.
  await app.until(() => Bun.file(stash).size === 0)
  await prunePromptMedia(temporary.path)
  expect(await Bun.file(kept).exists()).toBe(true)
}, 20000)

test("a local server's restored file video of any type gets its path at once, with the experiment off", async () => {
  await using temporary = await tmpdir()
  const video = path.join(temporary.path, "held.webm")
  const image = path.join(temporary.path, "held.png")
  await Promise.all([copyFile(videoFixture, video), copyFile(imageFixture, image)])
  const files = [
    { uri: pathToFileURL(video).href, name: "held.webm", mention: { start: 5, end: 14, text: "[Video 1]" } },
    { uri: pathToFileURL(image).href, name: "held.png", mention: { start: 15, end: 24, text: "[Image 1]" } },
  ]
  await using app = await openSession({}, { state: temporary.path, localServer: true })
  // As an undo puts the sent prompt back. The server reads the image itself, as before.
  const prompt = { text: "Look [Video 1] [Image 1]", files, agents: [], skills: [], pasted: [] }
  const composer = appendToSessionPrompt(session.id, prompt, app.renderer.widthMethod)
  expect(composer?.current.files).toEqual([{ ...files[0], path: video }, files[1]])

  app.mockInput.pressKey("c", { ctrl: true })
  const history = path.join(temporary.path, "prompt-history.jsonl")
  await app.until(() => Bun.file(history).size > 0)
  expect(JSON.parse((await Bun.file(history).text()).trim()).files).toEqual([{ ...files[0], path: video }, files[1]])
}, 20000)

test("a local server's restored files show as tiles, and a video that is gone is left out with a warning", async () => {
  await using temporary = await tmpdir()
  const video = path.join(temporary.path, "held.mp4")
  const image = path.join(temporary.path, "held.png")
  const mentioned = path.join(temporary.path, "seen.mp4")
  await Promise.all([copyFile(videoFixture, video), copyFile(imageFixture, image), copyFile(videoFixture, mentioned)])
  const files = [
    { uri: pathToFileURL(video).href, name: "held.mp4", mention: { start: 5, end: 14, text: "[Video 1]" } },
    { uri: pathToFileURL(mentioned).href, name: "seen.mp4", mention: { start: 15, end: 24, text: "@seen.mp4" } },
    { uri: pathToFileURL(image).href, name: "held.png", mention: { start: 25, end: 34, text: "[Image 1]" } },
  ]
  await using app = await popStash(temporary.path, { text: "Look [Video 1] @seen.mp4 [Image 1]", files }, true)
  await app.until(() => app.videos().length === transcriptTiles.videos + 2)
  await app.until(() => app.images().length === transcriptTiles.images + 1)

  // The server reads the image and the `@` mention itself; the video is read again here, and it is gone.
  await rm(video)
  app.mockInput.pressEnter()
  await app.waitForFrame((frame) => frame.includes("Could not read held.mp4 again"))
  await app.until(() => app.prompts.length === 1)
  expect(app.prompts[0]?.files?.map((file) => file.uri)).toEqual([
    pathToFileURL(mentioned).href,
    pathToFileURL(image).href,
  ])
}, 20000)

test("a remote server's restored file video gets no tile and is not sent, as this terminal cannot read it", async () => {
  await using temporary = await tmpdir()
  const held = path.join(temporary.path, "held.mp4")
  await copyFile(videoFixture, held)
  const files = [{ uri: pathToFileURL(held).href, name: "held.mp4", mention: { start: 5, end: 14, text: "[Video 1]" } }]
  await using app = await popStash(temporary.path, { text: "Look [Video 1]", files })
  await Bun.sleep(100)
  await app.renderOnce()
  expect(app.videos()).toHaveLength(transcriptTiles.videos)
  expect(app.captureCharFrame()).not.toContain("held.mp4")

  // Nor does the server get the uri, which would name this terminal's file.
  app.mockInput.pressEnter()
  await app.waitForFrame((frame) => frame.includes("Could not read held.mp4 again"))
  await app.until(() => app.prompts.length === 1)
  expect(app.prompts[0]?.files ?? []).toEqual([])
}, 20000)

test("keeps the old image previews with the experiment off", async () => {
  await using app = await openSession({ session: { image_preview: true }, prompt: { image_preview: true } })
  await app.until(() => app.images().length === transcriptTiles.images)
  await Bun.sleep(100)
  await app.renderOnce()
  expect(app.videos()).toEqual([])
  expect(app.captureCharFrame()).not.toContain("more")

  // A pasted video path stays text.
  app.mockInput.pasteBracketedText(videoFixture)
  await app.waitForFrame(() => app.composer().includes(videoFixture))
  expect(app.composer()).not.toContain("[Video")
}, 20000)
