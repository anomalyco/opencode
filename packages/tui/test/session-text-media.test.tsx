import { VideoRenderable } from "@opentui/core"
import { expect, test } from "bun:test"
import type { Config } from "../src/config"
import { createAppFixture } from "./fixture/app"
import { waitForHighlightedFrame } from "./fixture/frame"
import { descendants, videoFixture } from "./fixture/media"
import { directory, json } from "./fixture/tui-client"

const richMedia = { experimental: { rich_media: true } }
const location = { directory, project: { id: "proj_test", directory, canonical: directory } }
const toolVideo = `data:video/mp4;base64,${Buffer.from(await Bun.file(videoFixture).arrayBuffer()).toString("base64")}`
const session = {
  id: "ses_text_media",
  title: "Text media",
  projectID: "proj_test",
  location: { directory },
  cost: 0,
  agent: "build",
  model: { providerID: "demo", id: "model" },
  time: { created: 0, updated: 0 },
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
}
const reply = (id: string, time: { created: number; completed?: number }, content: unknown[]) => ({
  type: "assistant",
  id,
  agent: "build",
  model: { providerID: "demo", id: "model" },
  time,
  content,
})

/**
 * Opens a session whose finished reply names `video` and the `missing` files in its second text part, above a tool's
 * video, after a reply still streaming that names `video` too. `fs/list` lists `files`, and each listed path is logged
 * in `listed`.
 */
async function openSession(input: {
  config: Config.Info
  localServer?: boolean
  video: string
  missing: string[]
  files?: { path: string; type: "file" | "directory" }[]
}) {
  const listed: string[] = []
  const messages = [
    reply("msg_streaming", { created: 3 }, [{ type: "text", text: `Streaming \`${input.video}\`` }]),
    reply("msg_done", { created: 2, completed: 3 }, [
      { type: "text", text: "Rendering the clip." },
      {
        type: "text",
        text: `Rendered \`${input.video}\`, but ${input.missing.map((file) => `\`${file}\``).join(" and ")} failed.`,
      },
      {
        type: "tool",
        id: "call_render",
        name: "render",
        time: { created: 2, completed: 3 },
        state: {
          status: "completed",
          input: {},
          content: [{ type: "file", uri: toolVideo, mime: "video/mp4", name: "tool.mp4" }],
        },
      },
    ]),
  ]
  const setup = await createAppFixture({
    width: 100,
    height: 50,
    localServer: input.localServer,
    args: { sessionID: session.id },
    config: { animations: false, tabs: { enabled: false }, ...input.config },
    fetch: async (url) => {
      const rest = url.pathname.replace(/^\/api\/(experimental\/)?session\/ses_text_media/, "")
      if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
      // The startup listing has no path.
      if (url.pathname === "/api/fs/list" && url.searchParams.has("path")) {
        listed.push(url.searchParams.get("path")!)
        return json({ location, data: input.files ?? [] })
      }
      if (url.pathname === "/api/fs/read/out/demo.mp4") return new Response(Bun.file(videoFixture))
      if (url.pathname.startsWith("/api/fs/read/")) return json({ _tag: "NotFoundError" }, { status: 404 })
      if (url.pathname === "/api/fs/find") return json({ location, data: [] })
      if (rest === "/message") return json({ data: messages, cursor: {} })
      if (rest === "") return json({ data: session })
      if (rest === "/inbox" || rest === "/permission") return json({ data: [] })
      return undefined
    },
  })
  await setup.ready
  await waitForHighlightedFrame(setup, (frame) => frame.includes("failed.") && frame.includes("Streaming"))
  return Object.assign(setup, {
    listed,
    videos: () => descendants(setup.renderer.root).filter((node) => node instanceof VideoRenderable),
    viewer: () => descendants(setup.renderer.root).some((node) => node.id === "media-viewer"),
    // Existence checks and video tiles finish on the wall clock, so poll between frames.
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

type App = Awaited<ReturnType<typeof openSession>>

// The text's tile sits right under the text that names it, above the tool's, and opens first of the session's two
// videos.
async function openTextTile(app: App) {
  await app.until(() => app.videos().length === 2)
  const tile = app.videos().toSorted((a, b) => a.y - b.y)[0]!
  const lines = app.captureCharFrame().split("\n")
  expect(lines.findIndex((line) => line.includes("failed."))).toBeLessThan(tile.y)
  await app.mockMouse.click(tile.x + 1, tile.y + 1)
  await app.waitForFrame((frame) => app.viewer() && frame.includes("1 / 2"))
}

test("a local server's finished reply shows the existing video it names, which opens the viewer", async () => {
  await using app = await openSession({
    config: richMedia,
    localServer: true,
    video: videoFixture,
    missing: ["gone.mp4"],
  })
  await openTextTile(app)
  expect(app.captureCharFrame()).toContain("video-only.mp4")

  // Neither the missing file, whose check ended long before the viewer closed, nor the streaming reply's mention got a
  // tile.
  app.mockInput.pressEscape()
  await app.waitForFrame(() => !app.viewer())
  expect(app.videos()).toHaveLength(2)
  expect(app.listed).toEqual([])
}, 20000)

test("a remote server's files are found through one fs.list per directory, only inside the session's directory", async () => {
  await using app = await openSession({
    config: richMedia,
    video: `${directory}/out/demo.mp4`,
    missing: ["out/gone.mp4", "/elsewhere/clip.mp4"],
    files: [
      { path: "out/demo.mp4.part", type: "file" },
      { path: "out/demo.mp4", type: "file" },
      { path: "out/gone.mp4", type: "directory" },
    ],
  })
  // The one listing answered both files in `out`, so the missing one's answer is in by the time the other's tile shows.
  await openTextTile(app)
  expect(app.captureCharFrame()).toContain("demo.mp4")
  expect(app.listed).toEqual(["out"])
}, 20000)

test("with rich media off, a reply's named video gets no tile and is not looked for", async () => {
  await using app = await openSession({ config: {}, video: "out/demo.mp4", missing: ["gone.mp4"] })
  await Bun.sleep(100)
  await app.renderOnce()
  expect(app.videos()).toEqual([])
  expect(app.listed).toEqual([])
}, 20000)
