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
      localServer: false,
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

test("a remote server's gallery leaves out a generated image saved outside the session's Location", () => {
  const notice: SessionMessageInfo = {
    type: "synthetic",
    id: "generated",
    time: { created: 0 },
    text: "Image request finished. Saved image: /tmp/opencode/cat.png (provider/model).",
    metadata: { source: "experimental_image_generate", state: "completed", path: "/tmp/opencode/cat" },
  }
  createRoot((dispose) => {
    const gallery = (localServer: boolean) =>
      createSessionGallery(
        () => [notice],
        () => ({ directory: "/work" }),
        {
          localServer,
          connected: () => true,
          exists: async () => false,
        },
      )
    expect(gallery(true)().map((item) => item.id)).toEqual(["generated:generated"])
    expect(gallery(false)()).toEqual([])
    dispose()
  })
})

test("checks again after a delay that doubles to a minute when a check fails without an answer, until disposed", async () => {
  const checks: { file: string; answer: PromiseWithResolvers<boolean> }[] = []
  const timers: { delay: number; run: () => void; cancelled: boolean }[] = []
  const fail = async (index: number) => {
    checks[index]!.answer.reject(new Error("unavailable"))
    await settle()
  }
  const retry = async () => {
    timers.at(-1)!.run()
    await settle()
  }

  await createRoot(async (dispose) => {
    const [messages, setMessages] = createSignal([reply("saved", "Saved out.mp4")])
    const [connected, setConnected] = createSignal(true)
    const gallery = createSessionGallery(messages, () => ({ directory: "/work" }), {
      localServer: false,
      connected,
      exists: (file) => {
        const answer = Promise.withResolvers<boolean>()
        checks.push({ file, answer })
        return answer.promise
      },
      schedule: (run, delay) => {
        const timer = { delay, run, cancelled: false }
        timers.push(timer)
        return () => (timer.cancelled = true)
      },
    })
    await settle()
    for (const _ of Array.from({ length: 6 })) {
      await fail(checks.length - 1)
      await retry()
    }
    expect(timers.map((timer) => timer.delay)).toEqual([5_000, 10_000, 20_000, 40_000, 60_000, 60_000])
    expect(checks).toHaveLength(7)

    // A check that fails after a quick reconnect, which asked nothing while it ran, is retried too.
    setConnected(false)
    setConnected(true)
    await settle()
    expect(checks).toHaveLength(7)
    await fail(6)
    await retry()
    expect(checks).toHaveLength(8)

    // An answer that the file is missing is final.
    checks[7]!.answer.resolve(false)
    await settle()
    expect(timers).toHaveLength(7)
    expect(gallery()).toEqual([])

    // Disposing cancels a pending retry.
    setMessages([...messages(), reply("next", "Saved b.mp4")])
    await settle()
    await fail(8)
    expect(timers).toHaveLength(8)
    expect(timers.at(-1)!.cancelled).toBe(false)
    dispose()
    expect(timers.at(-1)!.cancelled).toBe(true)
  })
})
