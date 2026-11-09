import { expect, test } from "bun:test"
import type { SessionMessageInfo } from "@opencode/client"
import { createRoot, createSignal } from "solid-js"
import { createSessionGallery } from "../../../src/routes/session/gallery"

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

test("checks a named file once at a time, and again only for a reply that has not had an answer", async () => {
  const reply = (id: string, text: string): SessionMessageInfo => ({
    type: "assistant",
    id,
    time: { created: 0, completed: 1 },
    agent: "build",
    model: { id: "model", providerID: "provider" },
    content: [{ type: "text", text }],
  })
  const checks: { file: string; answer: PromiseWithResolvers<boolean> }[] = []
  const answer = async (index: number, exists: boolean | Error) => {
    if (exists instanceof Error) checks[index]?.answer.reject(exists)
    else checks[index]?.answer.resolve(exists)
    await Bun.sleep(0)
  }
  const prose = Array.from({ length: 200 }, (_, index) => reply(`prose${index}`, "Prose about mp4 files and .mov"))

  await createRoot(async (dispose) => {
    const [messages, setMessages] = createSignal([
      ...prose,
      reply("plan", "Rendering a.mp4 and later.mp4"),
      reply("again", "Still a.mp4 and later.mp4"),
    ])
    const [location, setLocation] = createSignal({ directory: "/work" })
    const gallery = createSessionGallery(messages, location, {
      exists: (file) => {
        const answer = Promise.withResolvers<boolean>()
        checks.push({ file, answer })
        return answer.promise
      },
    })
    const ids = () => gallery().map((item) => item.id)
    const checked = () => checks.map((check) => check.file)
    // Checks start once the collection that asks for them is done.
    await Bun.sleep(0)
    // Prose names no file, and the second reply's asks wait for the first's checks.
    expect(checked()).toEqual(["/work/a.mp4", "/work/later.mp4"])
    await answer(0, true)
    expect(ids()).toEqual(["plan:text:0:0", "again:text:0:0"])
    // The file it found stays found; the one it did not find is checked again for the reply that waited.
    await answer(1, false)
    expect(checked()).toEqual(["/work/a.mp4", "/work/later.mp4", "/work/later.mp4"])
    await answer(2, false)

    // Replies collected again, as when they update, check nothing again.
    setLocation({ directory: "/work" })
    await Bun.sleep(0)
    expect(checked()).toHaveLength(3)

    // A check that fails without an answer is asked again the next time the reply is collected.
    setMessages([...messages(), reply("flaky", "Saved b.mp4")])
    await Bun.sleep(0)
    expect(checked().at(-1)).toBe("/work/b.mp4")
    await answer(3, new Error("offline"))
    setLocation({ directory: "/work" })
    await Bun.sleep(0)
    expect(checked()).toEqual(["/work/a.mp4", "/work/later.mp4", "/work/later.mp4", "/work/b.mp4", "/work/b.mp4"])
    await answer(4, true)

    // A later step renders the planned file, and the reply that names it again finds it for every reply.
    setMessages([...messages(), reply("done", "Saved later.mp4")])
    await Bun.sleep(0)
    expect(checked().at(-1)).toBe("/work/later.mp4")
    await answer(5, true)
    expect(ids()).toEqual([
      "plan:text:0:0",
      "plan:text:0:1",
      "again:text:0:0",
      "again:text:0:1",
      "flaky:text:0:0",
      "done:text:0:0",
    ])
    dispose()
  })
})
