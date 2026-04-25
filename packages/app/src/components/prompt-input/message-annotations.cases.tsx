import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import type { createComponent as CreateComponent } from "solid-js"
import type { createStore as CreateStore } from "solid-js/store"
import type { ContextItem, MessageContextItem } from "@/context/prompt"

let createComponent: typeof CreateComponent
let createStore: typeof CreateStore
let render: typeof import("solid-js/web").render
let MessageAnnotations: typeof import("./message-annotations").MessageAnnotations
let contextFiles: typeof import("./message-annotations").contextFiles
let contextMessages: typeof import("./message-annotations").contextMessages
let dir = ""
const cwd = new URL("../../../", import.meta.url).pathname

const clean = new Set<VoidFunction>()

const hold = (fn: VoidFunction) => {
  let live = true

  const drop = () => {
    if (!live) return
    live = false
    clean.delete(drop)
    fn()
  }

  clean.add(drop)
  return drop
}

type Item = ContextItem & { key: string }
type FileItem = Item & { type: "file" }
type MessageItem = MessageContextItem & {
  key: string
  path: never
  selection?: never
  commentID?: never
  commentOrigin?: never
}

function createPrompt(items: MessageItem[]) {
  const [state, setState] = createStore({ items })

  return {
    items: () => state.items,
    remove: (annotationID: string) =>
      setState("items", (list) => list.filter((item) => item.annotationID !== annotationID)),
    update: (annotationID: string, next: Partial<MessageItem>) =>
      setState("items", (list) =>
        list.map((item) => {
          if (item.annotationID !== annotationID) return item
          return { ...item, ...next, path: item.path }
        }),
      ),
  }
}

const msg = (id: string, comment = `comment ${id}`, role: MessageItem["role"] = "assistant"): MessageItem => ({
  type: "message",
  key: `message:${id}`,
  annotationID: id,
  messageID: `msg-${id}`,
  role,
  quote: `quote ${id}\nline ${id}`,
  preview: `preview ${id}`,
  comment,
  path: undefined as never,
})

const file = (id: string, comment = `file ${id}`): FileItem => ({
  type: "file",
  key: `file:${id}`,
  path: `src/${id}.ts`,
  comment,
  commentID: id,
  selection: { startLine: 1, startChar: 0, endLine: 2, endChar: 0 },
})

const tick = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

const basket = () => document.querySelector('[data-component="message-annotation-basket"]')
const items = () => Array.from(document.querySelectorAll('[data-component="line-comment"]')) as HTMLDivElement[]
const comments = () =>
  Array.from(document.querySelectorAll('[data-slot="line-comment-textarea"]')) as HTMLTextAreaElement[]
const remove = () => Array.from(document.querySelectorAll('[data-slot="line-comment-action"]')) as HTMLButtonElement[]
const quotes = () => Array.from(document.querySelectorAll('[data-slot="line-comment-text"]')) as HTMLDivElement[]
const previews = () => Array.from(document.querySelectorAll('[data-slot="line-comment-label"]')) as HTMLDivElement[]
const plain = (value: unknown) => JSON.parse(JSON.stringify(value))

const mount = (prompt: ReturnType<typeof createPrompt>, placeholder = "Añadir comentario", deleteLabel = "Eliminar") => {
  const node = document.createElement("div")
  document.body.append(node)

  return hold(
    render(
      () =>
        createComponent(MessageAnnotations, {
          get items() {
            return prompt.items()
          },
          update: prompt.update,
          remove: prompt.remove,
          placeholder,
          deleteLabel,
        }),
      node,
    ),
  )
}

beforeAll(async () => {
  const entry = "../message-annotations.tsx"
  dir = new URL(`./.tmp-message-annotations-${Date.now()}/`, import.meta.url).pathname
  const fs = await import("node:fs/promises")
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(
    `${dir}/entry.ts`,
    [
      'export { createComponent } from "solid-js"',
      'export { createStore } from "solid-js/store"',
      'export { render } from "solid-js/web"',
      `export { MessageAnnotations, contextFiles, contextMessages } from ${JSON.stringify(entry)}`,
      "",
    ].join("\n"),
  )
  const build = Bun.spawnSync(
    ["bun", "build", `${dir}/entry.ts`, "--outdir", dir, "--target", "browser", "--format", "esm"],
    {
      cwd,
      stderr: "pipe",
      stdout: "pipe",
    },
  )
  if (build.exitCode !== 0)
    throw new Error(new TextDecoder().decode(build.stderr) || "Failed to build message annotations test bundle")

  const mod = await import(`${dir}/entry.js`)
  createComponent = mod.createComponent
  createStore = mod.createStore
  render = mod.render
  MessageAnnotations = mod.MessageAnnotations
  contextFiles = mod.contextFiles
  contextMessages = mod.contextMessages
})

afterAll(async () => {
  if (!dir) return
  const fs = await import("node:fs/promises")
  await fs.rm(dir, { recursive: true, force: true })
})

beforeEach(() => {
  document.body.innerHTML = ""
})

afterEach(() => {
  for (const drop of [...clean]) {
    drop()
  }

  document.body.innerHTML = ""
})

describe("MessageAnnotations", () => {
  test("basket keeps canonical line-comment copy and creation order", async () => {
    const prompt = createPrompt([msg("a1", "first note"), msg("a2", "second note", "user")])
    const dispose = mount(prompt)
    await tick()

    expect(basket()).toBeTruthy()
    expect(items()).toHaveLength(2)
    expect(comments()).toHaveLength(2)
    expect(remove()).toHaveLength(2)
    expect(quotes()).toHaveLength(2)
    expect(previews()).toHaveLength(2)
    expect(comments()[0]?.getAttribute("placeholder")).toBe("Añadir comentario")
    expect(comments()[1]?.getAttribute("placeholder")).toBe("Añadir comentario")
    expect(remove()[0]?.getAttribute("aria-label")).toBe("Eliminar")
    expect(remove()[0]?.textContent).toBe("Eliminar")
    expect(remove()[1]?.getAttribute("aria-label")).toBe("Eliminar")
    expect(items().map((item) => item.getAttribute("data-comment-id"))).toEqual(["a1", "a2"])
    expect(items()[0]?.getAttribute("data-inline")).toBe("")
    expect(items()[0]?.getAttribute("data-variant")).toBe("editor")
    expect(items()[0]?.textContent).toContain("assistant")
    expect(previews()[0]?.textContent).toBe("preview a1")
    expect(items()[1]?.textContent).toContain("user")
    expect(previews()[1]?.textContent).toBe("preview a2")
    expect(quotes()[0]?.textContent).toBe("quote a1\nline a1")
    expect(quotes()[1]?.textContent).toBe("quote a2\nline a2")

    dispose()
  })

  test("inline editing mutates only the targeted annotation", async () => {
    const prompt = createPrompt([msg("a1", "first note"), msg("a2", "second note", "user")])
    const dispose = mount(prompt)
    await tick()

    comments()[1]!.value = "updated second"
    comments()[1]!.dispatchEvent(new Event("input", { bubbles: true }))
    await tick()

    expect(plain(prompt.items())).toEqual([
      {
        type: "message",
        key: "message:a1",
        annotationID: "a1",
        messageID: "msg-a1",
        role: "assistant",
        quote: "quote a1\nline a1",
        preview: "preview a1",
        comment: "first note",
      },
      {
        type: "message",
        key: "message:a2",
        annotationID: "a2",
        messageID: "msg-a2",
        role: "user",
        quote: "quote a2\nline a2",
        preview: "preview a2",
        comment: "updated second",
      },
    ])

    dispose()
  })

  test("delete removes only the targeted annotation", async () => {
    const prompt = createPrompt([msg("a1", "drop me"), msg("a2", "keep me")])
    const dispose = mount(prompt)
    await tick()

    remove()[0]!.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    await tick()

    expect(plain(prompt.items())).toEqual([
      {
        type: "message",
        key: "message:a2",
        annotationID: "a2",
        messageID: "msg-a2",
        role: "assistant",
        quote: "quote a2\nline a2",
        preview: "preview a2",
        comment: "keep me",
      },
    ])
    dispose()

    const next = mount(prompt)
    await tick()

    expect(items()).toHaveLength(1)
    expect(items()[0]?.getAttribute("data-comment-id")).toBe("a2")
    expect(previews()[0]?.textContent).toBe("preview a2")
    expect(quotes()[0]?.textContent).toBe("quote a2\nline a2")

    next()
  })

  test("shell mode hides the basket and multiline quotes stay stable", async () => {
    const prompt = createPrompt([msg("a1", "keep quote")])
    const dispose = mount(prompt)
    await tick()

    expect(items()).toHaveLength(1)
    expect(quotes()[0]?.textContent).toBe("quote a1\nline a1")
    expect(quotes()[0]?.innerHTML).toContain("\n")
    dispose()

    const mixed: Item[] = [file("c1", "file note"), msg("a1", "one"), msg("a2", "two")]

    expect(contextFiles(mixed, "normal")).toMatchObject([{ type: "file", path: "src/c1.ts", commentID: "c1" }])
    expect(contextMessages(mixed, "normal")).toMatchObject([
      { type: "message", annotationID: "a1" },
      { type: "message", annotationID: "a2" },
    ])
    expect(contextMessages(mixed, "shell")).toEqual([])
    expect(contextFiles(mixed, "shell")).toEqual([])

    const node = document.createElement("div")
    document.body.append(node)

    const shell = hold(
      render(
        () =>
          createComponent(MessageAnnotations, {
            items: contextMessages(mixed, "shell"),
            update: prompt.update,
            remove: prompt.remove,
            placeholder: "Añadir comentario",
            deleteLabel: "Eliminar",
          }),
        node,
      ),
    )
    await tick()

    expect(basket()).toBeNull()

    shell()
  })
})
