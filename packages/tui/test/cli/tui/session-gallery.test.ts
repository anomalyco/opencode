import { expect, test } from "bun:test"
import type { SessionMessageInfo } from "@opencode/client"
import { createRoot, createSignal } from "solid-js"
import { createSessionGallery } from "../../../src/routes/session/gallery"

// Runs the checks' promise chains to the end; they wait on nothing else.
const settle = () => new Promise((resolve) => setImmediate(resolve))

const reply = (id: string, text: string): SessionMessageInfo => ({
  type: "assistant",
  id,
  time: { created: 0, completed: 1 },
  agent: "build",
  model: { id: "model", providerID: "provider" },
  content: [{ type: "text", text }],
})

test("collects only a changed message's media again", () => {
  let reads = 0
  // Counts each time the gallery reads a message's files.
  const user = (id: string): SessionMessageInfo => ({
    type: "user",
    id,
    text: "",
    time: { created: 0 },
    get files() {
      reads++
      return [{ data: "AAAA", mime: "image/png", source: { type: "inline" as const }, name: `${id}.png` }]
    },
  })
  const first = user("a")

  createRoot((dispose) => {
    const [messages, setMessages] = createSignal([first, user("b")])
    const gallery = createSessionGallery(messages, () => undefined)
    expect(gallery().map((item) => item.name)).toEqual(["a.png", "b.png"])

    setMessages([first, user("c")])
    expect(gallery().map((item) => item.name)).toEqual(["a.png", "c.png"])
    expect(reads).toBe(3)
    dispose()
  })
})

test("shares checks of a named file, and checks it again after a reconnect only when it had no answer", async () => {
  const checks: { file: string; answer: PromiseWithResolvers<boolean> }[] = []
  const checked = () => checks.map((check) => check.file)
  const answer = async (index: number, exists: boolean | Error) => {
    if (exists instanceof Error) checks[index]!.answer.reject(exists)
    else checks[index]!.answer.resolve(exists)
    await settle()
  }

  await createRoot(async (dispose) => {
    // Like the session store, which keeps message objects across updates and reconnects.
    const [messages, setMessages] = createSignal([
      reply("prose", "Prose about mp4 files and .mov"),
      reply("plan", "Rendering a.mp4 and later.mp4"),
      reply("again", "Still a.mp4 and later.mp4"),
    ])
    const add = async (...replies: SessionMessageInfo[]) => {
      setMessages([...messages(), ...replies])
      await settle()
    }
    const [connected, setConnected] = createSignal(true)
    const gallery = createSessionGallery(messages, () => ({ directory: "/work" }), {
      connected,
      exists: (file) => {
        const answer = Promise.withResolvers<boolean>()
        checks.push({ file, answer })
        return answer.promise
      },
    })
    const ids = () => gallery().map((item) => item.id)
    // Checks start once the collection that asks for them is done. Prose names no file, and replies that ask before a
    // check starts share it.
    await settle()
    expect(checked()).toEqual(["/work/a.mp4", "/work/later.mp4"])

    // Replies that ask while a check runs share one more check after it, which runs only if that found nothing.
    await add(reply("late", "Still later.mp4"), reply("later", "Still later.mp4 and a.mp4"))
    await answer(0, true)
    expect(ids()).toEqual(["plan:text:0:0", "again:text:0:0", "later:text:0:1"])
    expect(checked()).toHaveLength(2)
    await answer(1, false)
    expect(checked()).toEqual(["/work/a.mp4", "/work/later.mp4", "/work/later.mp4"])
    await answer(2, false)

    // A check that fails without an answer is asked again once the client reconnects, and not while it is away. A
    // file found missing is not asked again.
    await add(reply("flaky", "Saved b.mp4"))
    expect(checked().at(-1)).toBe("/work/b.mp4")
    await answer(3, new Error("offline"))
    setConnected(false)
    await settle()
    expect(checked()).toHaveLength(4)
    setConnected(true)
    await settle()
    expect(checked()).toEqual(["/work/a.mp4", "/work/later.mp4", "/work/later.mp4", "/work/b.mp4", "/work/b.mp4"])
    await answer(4, true)

    // A later step renders the planned file, and the reply that names it again finds it for every reply.
    await add(reply("done", "Saved later.mp4"))
    expect(checked().at(-1)).toBe("/work/later.mp4")
    await answer(5, true)
    expect(ids()).toEqual([
      "plan:text:0:0",
      "plan:text:0:1",
      "again:text:0:0",
      "again:text:0:1",
      "late:text:0:0",
      "later:text:0:0",
      "later:text:0:1",
      "flaky:text:0:0",
      "done:text:0:0",
    ])
    dispose()
  })
})
