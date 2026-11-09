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

test("checks a named file once, and a missing one again only when a later reply names it", async () => {
  const reply = (id: string, text: string): SessionMessageInfo => ({
    type: "assistant",
    id,
    time: { created: 0, completed: 1 },
    agent: "build",
    model: { id: "model", providerID: "provider" },
    content: [{ type: "text", text }],
  })
  const existing = new Set(["/work/a.mp4"])
  const checks: string[] = []
  const prose = Array.from({ length: 200 }, (_, index) => reply(`prose${index}`, "Prose about mp4 files and .mov"))

  await createRoot(async (dispose) => {
    const [messages, setMessages] = createSignal([
      ...prose,
      reply("plan", "Rendering a.mp4 and later.mp4"),
      reply("again", "Still a.mp4 and later.mp4"),
    ])
    const gallery = createSessionGallery(messages, () => ({ directory: "/work" }), {
      exists: async (file) => {
        checks.push(file)
        return existing.has(file)
      },
    })
    const ids = () => gallery().map((item) => item.id)
    // Prose names no file, and replies loaded together share each check.
    expect(checks).toEqual(["/work/a.mp4", "/work/later.mp4"])
    await Bun.sleep(0)
    expect(ids()).toEqual(["plan:text:0:0", "again:text:0:0"])

    // A reply collected again, as when it updates, checks nothing again.
    setMessages(messages().map((message) => (message.id === "plan" ? { ...message } : message)))
    expect(checks).toEqual(["/work/a.mp4", "/work/later.mp4"])

    // A later step renders the planned file, and the reply that names it again finds it.
    existing.add("/work/later.mp4")
    setMessages([...messages(), reply("done", "Saved later.mp4 and a.mp4")])
    expect(checks).toEqual(["/work/a.mp4", "/work/later.mp4", "/work/later.mp4"])
    await Bun.sleep(0)
    expect(ids()).toEqual([
      "plan:text:0:0",
      "plan:text:0:1",
      "again:text:0:0",
      "again:text:0:1",
      "done:text:0:0",
      "done:text:0:1",
    ])
    dispose()
  })
})
