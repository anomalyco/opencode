import { expect, test } from "bun:test"
import { createAppFixture } from "./fixture/app"
import { directory, json } from "./fixture/tui-client"
import { takeDraft } from "../src/component/prompt/draft-stash"
import type { PromptInfo } from "../src/prompt/history"
import { copyPlugin } from "./fixture/fixture"

const hash = "e".repeat(64)
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
)
const pngURI = `data:image/png;base64,${png.toString("base64")}`
const session = {
  id: "ses_media_refs",
  title: "Media refs",
  projectID: "proj_test",
  location: { directory },
  cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 0, updated: 0 },
}
const messages = [
  {
    type: "assistant",
    id: "msg_reply",
    agent: "build",
    model: { providerID: "fixture", id: "fixture" },
    finish: "stop",
    time: { created: 2, completed: 3 },
    content: [{ type: "text", text: "Looked at it" }],
  },
  {
    type: "user",
    id: "msg_shot",
    text: "What is in [Image 1]",
    files: [
      {
        uri: `media:${hash}`,
        mime: "image/png",
        source: { type: "inline" },
        name: "shot.png",
        mention: { start: 11, end: 20, text: "[Image 1]" },
      },
    ],
    time: { created: 1 },
  },
]
// What forking from msg_shot opens: its own transcript, with a different prompt to undo.
const forked = { ...session, id: "ses_forked", title: "Forked" }
const forkedMessages = [
  { ...messages[0], id: "msg_forked_reply" },
  { ...messages[1], id: "msg_forked_ask", text: "Forked ask [Image 1]" },
]
const queuedShot = {
  id: "msg_queued",
  sessionID: session.id,
  type: "user",
  delivery: "queue",
  payload: messages[1],
  time: { created: 4 },
}

// The requests a rewind makes, logged with their status.
const MEDIA = `GET /api/experimental/media/${hash}`
const REVERT = `POST /api/session/${session.id}/revert/stage`
const CANCEL = `DELETE /api/session/${session.id}/inbox/msg_queued`
const FORK = `POST /api/session/${session.id}/fork`
const FORKED_REVERT = `POST /api/session/${forked.id}/revert/stage`

type Respond = () => Response | Promise<Response>
const image: Respond = () => new Response(png, { headers: { "content-type": "image/png" } })
// What the server answers once a blob is swept, and a failure where the blob may still exist.
const gone: Respond = () =>
  json({ _tag: "FileNotFoundError", path: `/api/experimental/media/${hash}`, message: "gone" }, { status: 404 })
const unavailable: Respond = () => new Response("unavailable", { status: 503 })

/** Opens the session against a fake server. `calls` logs media reads and rewinds as `<request> <status>`. */
async function openSession(server: { inbox?: unknown[]; plugins?: string[]; respond?: Record<string, Respond> }) {
  // Drafts are stashed per tab for the whole process, so an earlier test or test file would prefill a composer. A home
  // draft would also turn the slash command typed there by `leaveAndReturn` into more text.
  for (const id of [undefined, session.id, forked.id]) takeDraft(id)
  const calls: string[] = []
  const capabilities = new Map<string, string | null>()
  const logged: Partial<Record<string, Respond>> = {
    [MEDIA]: image,
    [REVERT]: () => json({ data: session }),
    [CANCEL]: () => new Response(null, { status: 204 }),
    [FORK]: () => json({ data: forked }),
    [FORKED_REVERT]: () => json({ data: forked }),
    ...server.respond,
  }
  const setup = await createAppFixture({
    width: 100,
    height: 30,
    config: { animations: false, tabs: { enabled: false }, plugins: server.plugins },
    args: { sessionID: session.id },
    fetch: async (url, request) => {
      const key = `${request.method} ${url.pathname}`
      const [, id, rest] = /^\/api\/(?:experimental\/)?session\/([^/]+)(.*)$/.exec(url.pathname) ?? []
      const info = [session, forked].find((item) => item.id === id)
      if (rest === "/message") {
        capabilities.set(url.pathname, request.headers.get("x-opencode-capabilities"))
        return json({ data: id === session.id ? messages : id === forked.id ? forkedMessages : [], cursor: {} })
      }
      if (url.pathname === "/api/session") return json({ data: [session], cursor: {} })
      if (info && (rest === "" || rest === "/interrupt")) return json({ data: info })
      if (info && rest === "/inbox") return json({ data: id === session.id ? (server.inbox ?? []) : [] })
      if (info && rest === "/permission") return json({ data: [] })
      if (info && rest === "/wait") return new Response(null, { status: 204 })
      const respond = logged[key]
      if (!respond) return undefined
      // Logged on arrival, so a test can act while a read is still waiting; the status is added once it answers.
      calls.push(key)
      const response = await respond()
      calls[calls.lastIndexOf(key)] = `${key} ${response.status}`
      return response
    },
  })
  await setup.waitForFrame((frame) => frame.includes("Looked at it"))
  return Object.assign(setup, { calls, capabilities })
}

type App = Awaited<ReturnType<typeof openSession>>

async function undoLast(app: App) {
  await app.mockInput.typeText("/undo")
  app.mockInput.pressEnter()
}

async function undoQueued(app: App) {
  app.mockInput.pressKey("x", { ctrl: true })
  app.mockInput.pressKey("q")
  await app.waitForFrame((frame) => frame.includes("Queued prompts"))
  app.mockInput.pressKey("u", { ctrl: true })
  await app.waitForFrame(() => true)
}

// Picks one of a message's actions from /timeline.
async function messageAction(app: App, action: string) {
  await app.mockInput.typeText("/timeline")
  app.mockInput.pressEnter()
  await app.waitForFrame((frame) => frame.includes("Jump to message") || frame.includes("Timeline"))
  app.mockInput.pressEnter()
  await app.waitForFrame((frame) => frame.includes(action))
  await app.mockInput.typeText(action)
  app.mockInput.pressEnter()
}

// Waits for `done`, then gives anything that shouldn't follow, such as a rewind after a failed read or a composer
// change, time to show before reading the frame.
async function settled(app: App, done: (frame: string) => boolean) {
  await app.waitForFrame(done)
  await Bun.sleep(50)
  return app.waitForFrame(() => true)
}

// How many times the frame shows the prompt: once in the transcript, twice once it is also back in the composer.
const shown = (frame: string) => frame.split("What is in [Image 1]").length - 1

test("reads transcripts with media refs and loads a ref's bytes before /undo rewinds its message", async () => {
  await using app = await openSession({})
  expect([...app.capabilities.values()]).toEqual(["experimental-media-uri"])
  // Image previews are off by default, so showing the transcript reads no media.
  expect(app.calls).toEqual([])

  await undoLast(app)
  await app.waitForFrame((frame) => shown(frame) === 2)
  expect(app.calls).toEqual([`${MEDIA} 200`, `${REVERT} 200`])
}, 20000)

// Starts an undo, leaves the session while its media read waits, then lets the read finish.
async function undoAfterLeaving(input: { inbox: unknown[]; undo: (app: App) => Promise<void> }) {
  const media = Promise.withResolvers<void>()
  await using app = await openSession({ inbox: input.inbox, respond: { [MEDIA]: () => media.promise.then(image) } })
  await input.undo(app)
  await app.waitForFrame(() => app.calls.length > 0)
  await app.mockInput.typeText("/new")
  app.mockInput.pressEnter()
  await app.waitForFrame((frame) => !frame.includes("Looked at it"))
  media.resolve()
  // The rewind's request is logged on arrival, but the draft is written only once its response is back.
  let draft: PromptInfo | undefined
  await app.waitForFrame(() => (draft ??= takeDraft(session.id)?.prompt) !== undefined)
  return { calls: app.calls, draft }
}

test("an /undo that finishes after its session closed keeps the prompt in that session's draft", async () => {
  const { calls, draft } = await undoAfterLeaving({ inbox: [], undo: undoLast })

  expect(calls).toEqual([`${MEDIA} 200`, `${REVERT} 200`])
  expect(draft?.text).toBe("What is in [Image 1]")
  expect(draft?.files?.map((file) => file.uri)).toEqual([pngURI])
}, 20000)

test("undoing a queued prompt after its session closed cancels it in that session and keeps it as a draft", async () => {
  const { calls, draft } = await undoAfterLeaving({
    inbox: [queuedShot],
    undo: async (app) => {
      await undoQueued(app)
      app.mockInput.pressEscape()
    },
  })

  expect(calls).toEqual([`${MEDIA} 200`, `${CANCEL} 204`])
  expect(draft?.text).toBe("What is in [Image 1]")
  expect(draft?.files?.map((file) => file.uri)).toEqual([pngURI])
}, 20000)

// Undoes a prompt whose image read fails, until `done` shows the outcome. The composer is read from the draft it leaves
// when the app closes.
async function undoWithFailedRead(media: Respond, queued: boolean, done: (frame: string, app: App) => boolean) {
  const result = await (async () => {
    await using app = await openSession({ inbox: queued ? [queuedShot] : [], respond: { [MEDIA]: media } })
    await (queued ? undoQueued(app) : undoLast(app))
    const frame = await settled(app, (frame) => app.calls.length > 0 && done(frame, app))
    return { calls: app.calls, frame }
  })()
  return { ...result, draft: takeDraft(session.id)?.prompt }
}

for (const queued of [false, true]) {
  const name = queued ? "undoing a queued prompt" : "/undo"

  test(`${name} goes ahead without an image the server no longer has`, async () => {
    // The warning shows before the rewind; the prompt reaches the composer once it's done.
    const { calls, frame, draft } = await undoWithFailedRead(
      gone,
      queued,
      (frame, app) =>
        frame.includes("no longer stored") && !!app.renderer.currentFocusedEditor?.plainText.includes("What is in"),
    )

    expect(calls).toEqual([`${MEDIA} 404`, queued ? `${CANCEL} 204` : `${REVERT} 200`])
    expect(draft?.text).toBe("What is in [Image 1]")
    expect(draft?.files).toEqual([])
    expect(frame).toContain("no longer stored")
  }, 20000)

  test(`${name} keeps the message when an image read fails for another reason`, async () => {
    const { calls, draft } = await undoWithFailedRead(unavailable, queued, (frame) => /unavailable|503/i.test(frame))

    expect(calls).toEqual([`${MEDIA} 503`])
    expect(draft).toBeUndefined()
  }, 20000)
}

test("a revert the server refuses leaves the composer as it was", async () => {
  await using app = await openSession({
    respond: { [REVERT]: () => json({ name: "BusyError", data: {} }, { status: 409 }) },
  })
  await messageAction(app, "Revert")
  const frame = await settled(app, () => app.calls.includes(`${REVERT} 409`))

  expect(app.calls).toEqual([`${MEDIA} 200`, `${REVERT} 409`])
  expect(shown(frame)).toBe(1)
}, 20000)

test("a revert goes ahead without an image the server no longer has", async () => {
  await using app = await openSession({ respond: { [MEDIA]: gone } })
  await messageAction(app, "Revert")
  const frame = await settled(app, (frame) => shown(frame) === 2)

  expect(app.calls).toEqual([`${MEDIA} 404`, `${REVERT} 200`])
  expect(shown(frame)).toBe(2)
  expect(frame).toContain("no longer stored")
}, 20000)

test("a revert whose image read fails for another reason does not revert", async () => {
  await using app = await openSession({ respond: { [MEDIA]: unavailable } })
  await messageAction(app, "Revert")
  const frame = await settled(app, () => app.calls.includes(`${MEDIA} 503`))

  expect(app.calls).toEqual([`${MEDIA} 503`])
  expect(shown(frame)).toBe(1)
}, 20000)

test("forking from a prompt whose image is gone does not fork", async () => {
  await using app = await openSession({ respond: { [MEDIA]: gone } })
  await messageAction(app, "Fork")
  await settled(app, () => app.calls.includes(`${MEDIA} 404`))

  expect(app.calls).toEqual([`${MEDIA} 404`])
}, 20000)

test("plugins read messages with inline bytes while the transcript reads media refs", async () => {
  await using plugin = await copyPlugin("client-reads")
  await using app = await openSession({ plugins: [plugin.directory] })
  await app.waitForFrame(() => app.capabilities.size === 2)

  expect(Object.fromEntries(app.capabilities)).toEqual({
    [`/api/session/${session.id}/message`]: "experimental-media-uri",
    "/api/session/ses_plugin_probe/message": null,
  })
}, 20000)

async function leaveAndReturn(app: App) {
  // A leader key, since text in the composer would turn a slash command into more text.
  app.mockInput.pressKey("x", { ctrl: true })
  app.mockInput.pressKey("n")
  await app.waitForFrame((frame) => !frame.includes("Looked at it"))
  await app.mockInput.typeText("/sessions")
  app.mockInput.pressEnter()
  await app.waitForFrame((frame) => frame.includes("Sessions") && frame.includes("Media refs"))
  app.mockInput.pressEnter()
  await app.waitForFrame((frame) => frame.includes("Looked at it"))
}

for (const queued of [false, true]) {
  const name = queued ? "a queued-prompt undo" : "an /undo"

  test(`${name} that finishes after leaving and returning joins what was typed since`, async () => {
    const media = Promise.withResolvers<void>()
    const result = await (async () => {
      await using app = await openSession({
        inbox: queued ? [queuedShot] : [],
        respond: { [MEDIA]: () => media.promise.then(image) },
      })
      if (queued) {
        await undoQueued(app)
        app.mockInput.pressEscape()
      } else await undoLast(app)
      await app.waitForFrame(() => app.calls.length > 0)
      await leaveAndReturn(app)
      await app.mockInput.typeText("typed note")
      media.resolve()
      // The rewind finishes by appending the prompt to the live composer, after what was typed.
      await app.waitForFrame(() => !!app.renderer.currentFocusedEditor?.plainText.includes("What is in"))
      await leaveAndReturn(app)
      return { calls: app.calls, frame: await app.waitForFrame((frame) => frame.includes("typed note")) }
    })()
    const draft = takeDraft(session.id)?.prompt

    expect(result.calls).toEqual([`${MEDIA} 200`, queued ? `${CANCEL} 204` : `${REVERT} 200`])
    expect(result.frame).toContain("typed note")
    expect(draft?.text).toBe("typed note\n\nWhat is in [Image 1]")
    expect(draft?.files?.map((file) => file.uri)).toEqual([pngURI])
  }, 30000)
}

test("an undo in a session opened with a seeded prompt, such as a fork, lands in its composer", async () => {
  const result = await (async () => {
    await using app = await openSession({})
    await messageAction(app, "Fork")
    // The fork opens with the forked-from prompt already in its composer.
    await app.waitForFrame((frame) => frame.includes("Forked ask") && frame.includes("What is in [Image 1]"))
    app.mockInput.pressKey("x", { ctrl: true })
    app.mockInput.pressKey("u")
    // Once in the transcript and once more in the composer, after the seeded prompt.
    const frame = await settled(app, (frame) => frame.split("Forked ask").length - 1 === 2)
    return { calls: app.calls, frame }
  })()
  const draft = takeDraft(forked.id)?.prompt

  expect(result.calls).toEqual([`${MEDIA} 200`, `${FORK} 200`, `${FORKED_REVERT} 200`])
  expect(result.frame).toContain("What is in [Image 1]")
  expect(draft?.text).toBe("What is in [Image 1]\n\nForked ask [Image 1]")
  expect(draft?.files?.map((file) => file.uri)).toEqual([pngURI, pngURI])
}, 30000)
