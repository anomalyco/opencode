import { ImageRenderable, InputRenderable, TextareaRenderable, VideoRenderable, type Renderable } from "@opentui/core"
import { expect, test } from "bun:test"
import { copyFile, rm } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { takeDraft } from "../src/component/prompt/draft-stash"
import { MAX_LOCAL_ATTACHMENT_BYTES } from "../src/component/prompt/local-attachment"
import { registerMediaViews, useMedia, type MediaContext, type MediaViewerRequest } from "../src/context/media"
import type { Config } from "../src/config"
import { createAppFixture } from "./fixture/app"
import { tmpdir } from "./fixture/fixture"
import { imageFixture, videoFixture } from "./fixture/media"
import { directory, json } from "./fixture/tui-client"

const videoURI = `data:video/mp4;base64,${Buffer.from(await Bun.file(videoFixture).arrayBuffer()).toString("base64")}`
const imageURI = `data:image/png;base64,${Buffer.from(await Bun.file(imageFixture).arrayBuffer()).toString("base64")}`
const time = { created: 1, completed: 2 }
// The server saved the generated image in the session's directory, which this terminal reads through the server.
const generated = `${directory}/generated/image`
const session = {
  agent: "build",
  model: { providerID: "demo", id: "model" },
  id: "ses_inline_media",
  title: "Inline media",
  projectID: "proj_test",
  location: { directory },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0, updated: 0 },
}
// The tool's files alternate images and videos; at 100 columns only the first three fit before "+3 more".
const files = [imageURI, videoURI, imageURI, videoURI, imageURI, videoURI].map((uri, index) => ({
  type: "file",
  uri,
  mime: uri.startsWith("data:video/") ? "video/mp4" : "image/png",
  name: `shot-${index}`,
}))
// Listed newest first, as the server pages them.
const messages = [
  {
    type: "synthetic",
    id: "msg_generated",
    time: { created: 3 },
    description: "Image generation",
    text: `<image id="image_1" state="completed">\nImage request finished. Saved image: ${generated}.png (provider/model).\n</image>`,
    metadata: { source: "experimental_image_generate", state: "completed", path: generated },
  },
  {
    type: "assistant",
    id: "msg_reply",
    agent: "build",
    model: { providerID: "fixture", id: "fixture" },
    finish: "stop",
    time,
    content: [
      {
        type: "tool",
        id: "call_shots",
        name: "screenshot",
        time,
        state: { status: "completed", input: {}, content: [{ type: "text", text: "captured" }, ...files] },
      },
      { type: "text", text: "Captured the frames" },
    ],
  },
  {
    type: "user",
    id: "msg_ask",
    text: "What happens in [Video 1]",
    files: [
      {
        data: videoURI.slice(videoURI.indexOf(",") + 1),
        mime: "video/mp4",
        source: { type: "inline" },
        name: "clip.mp4",
        mention: { start: 18, end: 27, text: "[Video 1]" },
      },
    ],
    time: { created: 1 },
  },
]

const location = { directory, project: { id: "proj_test", directory, canonical: directory } }

async function openSession(config: Config.Info, options: { state?: string; revert?: string; inbox?: unknown[] } = {}) {
  takeDraft(session.id)
  const prompts: { text: string; files?: { uri: string }[] }[] = []
  const reads: string[] = []
  const info = { ...session, ...(options.revert ? { revert: { messageID: options.revert } } : {}) }
  const setup = await createAppFixture({
    width: 100,
    height: 60,
    state: options.state,
    config: { animations: false, tabs: { enabled: false }, ...config },
    args: { sessionID: session.id },
    fetch: async (url, request) => {
      const [, id, rest] = /^\/api\/(?:experimental\/)?session\/([^/]+)(.*)$/.exec(url.pathname) ?? []
      if (url.pathname === "/api/session") return json({ data: [info], cursor: {} })
      if (url.pathname === "/api/fs/read/generated/image.png") {
        reads.push(url.pathname)
        return new Response(Bun.file(imageFixture))
      }
      if (url.pathname === "/api/agent")
        return json({ location, data: [{ id: "build", mode: "primary", hidden: false, permissions: [] }] })
      if (url.pathname === "/api/provider") return json({ location, data: [{ id: "demo", name: "Demo" }] })
      if (url.pathname === "/api/model")
        return json({ location, data: [{ id: "model", providerID: "demo", name: "Demo Model", variants: [] }] })
      if (id !== session.id) return undefined
      if (rest === "/message") return json({ data: messages, cursor: {} })
      if (rest === "") return json({ data: info })
      if (rest === "/inbox") return json({ data: options.inbox ?? [] })
      if (rest === "/permission") return json({ data: [] })
      if (rest === "/prompt") {
        const body = await request.json()
        prompts.push(body)
        return json({
          data: {
            id: body.id,
            sessionID: session.id,
            type: "user",
            time: { created: 10 },
            payload: { text: body.text },
          },
        })
      }
      return undefined
    },
  })
  await setup.ready
  await setup.waitForFrame((frame) => frame.includes("Captured the frames") || frame.includes("What happens in"))
  return Object.assign(setup, {
    prompts,
    reads,
    nodes: () => descendants(setup.renderer.root),
    composer: () => setup.renderer.currentFocusedEditor?.plainText ?? "",
    // Video tiles open and decode on the wall clock, so poll between frames.
    async until(condition: () => boolean) {
      const deadline = Date.now() + 5_000
      while (!condition() && Date.now() < deadline) {
        await Bun.sleep(10)
        await setup.renderOnce()
      }
      expect(condition()).toBe(true)
    },
  })
}

/** Registers a viewer that records each request it opens with, and the media context it reads. */
function recordViewer() {
  const requests: MediaViewerRequest[] = []
  let media: MediaContext | undefined
  const restore = registerMediaViews({
    viewer: () => {
      media = useMedia()
      const request = media.viewer()
      if (request) requests.push(request)
      return null
    },
  })
  return {
    requests,
    close: () => media?.closeViewer(),
    [Symbol.dispose]: restore,
  }
}

function descendants(node: Renderable): Renderable[] {
  return node.getChildren().flatMap((child) => [child, ...descendants(child as Renderable)])
}

function position(frame: string, text: string) {
  const lines = frame.split("\n")
  const y = lines.findIndex((line) => line.includes(text))
  return { x: lines[y]!.indexOf(text) + 1, y }
}

test("shows user, tool, and generated media as tiles that open the whole session gallery", async () => {
  await using app = await openSession({ experimental: { "rich-media": true } })
  using viewer = recordViewer()
  // One user video, three of the tool's six files, and the generated image.
  await app.until(
    () =>
      app.nodes().filter((node) => node instanceof VideoRenderable).length === 2 &&
      app.nodes().filter((node) => node instanceof ImageRenderable).length === 3,
  )
  const videos = app.nodes().filter((node) => node instanceof VideoRenderable)
  expect(videos.every((video) => video.paused && !video.audio)).toBe(true)
  expect(app.reads).toEqual(["/api/fs/read/generated/image.png"])
  const frame = app.captureCharFrame()
  expect(frame).toContain("+3 more")

  const more = position(frame, "+3 more")
  await app.mockMouse.click(more.x, more.y)
  await app.waitForFrame(() => viewer.requests.length === 1)
  const request = viewer.requests[0]!
  expect(request.items.map((item) => item.id)).toEqual([
    "msg_ask:file:0",
    ...[1, 2, 3, 4, 5, 6].map((index) => `msg_reply:tool:call_shots:${index}`),
    "msg_generated:generated",
  ])
  expect(request.items.at(-1)?.uri).toBe(`file://${generated}.png`)
  // The first hidden tool file, after the user's video and the three tiles shown.
  expect(request.index).toBe(4)

  viewer.close()
  const user = videos[0]!
  await app.mockMouse.click(user.x + 2, user.y + 1)
  await app.waitForFrame(() => viewer.requests.length === 2)
  expect(viewer.requests[1]?.index).toBe(0)

  viewer.close()
  app.mockInput.pressKey("x", { ctrl: true })
  app.mockInput.pressKey("v")
  await app.waitForFrame(() => viewer.requests.length === 3)
  expect(viewer.requests[2]?.index).toBe(7)
}, 20000)

test("keeps the image previews and shows no video with the experiment off", async () => {
  await using app = await openSession({ session: { image_preview: true }, prompt: { image_preview: true } })
  // The user's video and the tool's videos have no preview; the tool's images show as the old thumbnails.
  await app.until(() => app.nodes().filter((node) => node instanceof ImageRenderable).length === 3)
  await Bun.sleep(100)
  await app.renderOnce()
  expect(app.nodes().some((node) => node instanceof VideoRenderable)).toBe(false)
  expect(app.captureCharFrame()).not.toContain("more")

  // A pasted video path stays text.
  app.mockInput.pasteBracketedText(videoFixture)
  await app.waitForFrame(() => app.composer().includes(videoFixture))
  expect(app.composer()).not.toContain("[Video")
}, 20000)

test("leaves out reverted and queued messages' media", async () => {
  const queued = {
    id: "msg_queued",
    sessionID: session.id,
    type: "user",
    delivery: "queue",
    time: { created: 5 },
    payload: { text: "And [Image 1]", files: [{ ...files[0], source: { type: "inline" } }] },
  }
  await using app = await openSession(
    { experimental: { "rich-media": true } },
    { revert: "msg_generated", inbox: [queued] },
  )
  using viewer = recordViewer()
  await app.until(() => app.nodes().filter((node) => node instanceof VideoRenderable).length === 1)
  app.mockInput.pressKey("x", { ctrl: true })
  app.mockInput.pressKey("v")
  await app.waitForFrame(() => viewer.requests.length === 1)
  expect(viewer.requests[0]?.items.map((item) => item.id)).toEqual(["msg_ask:file:0"])
}, 20000)

test("keeps the prompt unfocused while the viewer is open", async () => {
  await using app = await openSession({ experimental: { "rich-media": true } })
  using viewer = recordViewer()
  await app.waitFor(() => app.renderer.currentFocusedEditor instanceof TextareaRenderable)
  await app.mockInput.typeText("draft")
  app.mockInput.pressKey("p", { ctrl: true })
  await app.waitFor(() => app.renderer.currentFocusedEditor instanceof InputRenderable)
  await app.mockInput.typeText("View media")
  await app.waitForFrame((frame) => frame.includes("View media"))
  app.mockInput.pressEnter()
  await app.waitForFrame(() => viewer.requests.length === 1)
  // Past the dialog's refocus timer.
  await Bun.sleep(50)
  await app.mockInput.typeText("abc")
  app.mockInput.pressEnter()
  await Bun.sleep(50)
  await app.renderOnce()
  const prompt = descendants(app.renderer.root).find((node) => node instanceof TextareaRenderable)
  expect(prompt?.plainText).toBe("draft")
  expect(app.renderer.currentFocusedEditor).toBeNull()
  expect(app.prompts).toEqual([])

  viewer.close()
  await app.waitFor(() => app.renderer.currentFocusedEditor === prompt)
}, 20000)

test("opens the registered viewer from a tile and closes it back to the prompt", async () => {
  await using app = await openSession({ experimental: { "rich-media": true } })
  await app.until(() => app.nodes().filter((node) => node instanceof VideoRenderable).length === 2)
  const user = app.nodes().find((node) => node instanceof VideoRenderable)!
  await app.mockMouse.click(user.x + 2, user.y + 1)
  const frame = await app.waitForFrame((frame) => frame.includes("1 / 8"))
  expect(frame).toContain("clip.mp4")
  expect(app.renderer.root.findDescendantById("media-viewer")).toBeDefined()

  app.mockInput.pressEscape()
  await app.waitForFrame((frame) => !frame.includes("1 / 8"))
  expect(app.renderer.root.findDescendantById("media-viewer")).toBeUndefined()
  await app.waitFor(() => app.renderer.currentFocusedEditor instanceof TextareaRenderable)
}, 20000)

test("attaches pasted videos, keeps only their paths in history, and sends their bytes again", async () => {
  await using temporary = await tmpdir()
  const large = path.join(temporary.path, "large.mp4")
  const gone = path.join(temporary.path, "gone.mp4")
  await Bun.write(large, new Uint8Array(MAX_LOCAL_ATTACHMENT_BYTES + 1))
  await copyFile(videoFixture, gone)
  const state = path.join(temporary.path, "state")
  await using app = await openSession({ experimental: { "rich-media": true } }, { state })
  const transcript = () =>
    app
      .nodes()
      .filter((node) => node instanceof VideoRenderable)
      .slice(0, 2)
  await app.until(() => transcript().length === 2)
  const tiles = transcript()
  const composerVideos = () => app.nodes().filter((node) => node instanceof VideoRenderable).length - 2

  app.mockInput.pasteBracketedText(videoFixture)
  await app.waitForFrame(() => app.composer().includes("[Video 1]"))
  app.mockInput.pasteBracketedText(gone)
  await app.waitForFrame(() => app.composer().includes("[Video 2]"))
  await app.until(() => composerVideos() === 2)

  app.mockInput.pasteBracketedText(large)
  const warned = await app.waitForFrame((frame) => frame.includes("over the 20 MiB attachment limit"))
  expect(warned).toContain("large.mp4")
  expect(app.composer()).toContain(large)

  // Clearing keeps the prompt in history with the videos' paths instead of their bytes.
  app.mockInput.pressKey("c", { ctrl: true })
  await app.waitForFrame(() => app.composer() === "")
  const history = path.join(state, "prompt-history.jsonl")
  await app.until(() => Bun.file(history).size > 0)
  const saved = await Bun.file(history).text()
  expect(saved).toContain("[Video 2]")
  expect(saved).toContain(JSON.stringify(pathToFileURL(videoFixture).href))
  expect(saved).not.toContain("data:video")

  // Sent right away, the restored prompt reads the videos again and leaves out the one that is gone.
  await rm(gone)
  app.mockInput.pressArrow("up")
  await app.waitForFrame(() => app.composer().includes("[Video 2]"))
  app.mockInput.pressEnter()
  await app.waitForFrame((frame) => frame.includes("Could not read gone.mp4 again"))
  await app.until(() => app.prompts.length === 1)
  expect(app.prompts[0]?.files?.map((file) => file.uri.slice(0, 22))).toEqual(["data:video/mp4;base64,"])

  // The sent message adds its video to the transcript without rebuilding the tiles already there.
  await app.until(() => app.nodes().filter((node) => node instanceof VideoRenderable).length === 3)
  expect(tiles.every((tile) => app.nodes().includes(tile))).toBe(true)
}, 20000)

test("gives a restored video without a local file one in the media cache, so history keeps only its path", async () => {
  await using temporary = await tmpdir()
  const state = path.join(temporary.path, "state")
  const prompt = {
    text: "Look [Video 1]",
    files: [{ uri: videoURI, mention: { start: 5, end: 14, text: "[Video 1]" } }],
    agents: [],
    skills: [],
    pasted: [],
  }
  await Bun.write(path.join(state, "prompt-stash.jsonl"), JSON.stringify({ prompt, timestamp: 1 }) + "\n")
  await using app = await openSession({ experimental: { "rich-media": true } }, { state })
  const videos = () => app.nodes().filter((node) => node instanceof VideoRenderable).length
  await app.until(() => videos() === 2)

  app.mockInput.pressKey("p", { ctrl: true })
  await app.waitFor(() => app.renderer.currentFocusedEditor instanceof InputRenderable)
  await app.mockInput.typeText("Stash pop")
  await app.waitForFrame((frame) => frame.includes("Stash pop"))
  app.mockInput.pressEnter()
  await app.waitForFrame(() => app.composer() === "Look [Video 1]")
  await app.until(() => videos() === 3)

  app.mockInput.pressKey("c", { ctrl: true })
  await app.waitForFrame(() => app.composer() === "")
  const history = path.join(state, "prompt-history.jsonl")
  await app.until(() => Bun.file(history).size > 0)
  const file = JSON.parse((await Bun.file(history).text()).trim()).files[0]
  expect(file.uri).toBe(pathToFileURL(file.path).href)
  expect(path.extname(file.path)).toBe(".mp4")
  expect(Buffer.from(await Bun.file(file.path).arrayBuffer()).toString("base64")).toBe(videoURI.split(",")[1])
}, 20000)
