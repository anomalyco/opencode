import { AffineSchemas } from "@blocksuite/blocks/schemas"
import { DocCollection, Schema, Text, type Doc } from "@blocksuite/store"
import { afterEach, describe, expect, test } from "bun:test"
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client"
import { docMarkdown, docPlain } from "./doc-content"
import { initDoc } from "./doc-init"

type Opts = Parameters<typeof docMarkdown>[1]
type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

const cols: DocCollection[] = []

function page() {
  const schema = new Schema().register(AffineSchemas)
  const col = new DocCollection({ schema })
  cols.push(col)
  col.meta.initialize()
  const doc = col.createDoc({ id: "page" })
  initDoc(doc)
  const note = doc.getBlockByFlavour("affine:note")[0]
  if (!note) throw new Error("missing note")
  return { doc, note: note.id }
}

function opts(fetch: Fetch): Opts {
  return {
    docID: "doc_1",
    directory: "/tmp/project",
    client: createOpencodeClient({
      baseUrl: "http://localhost:4096",
      directory: "/tmp/project",
      fetch: fetch as unknown as typeof globalThis.fetch,
      throwOnError: true,
    }),
  }
}

function add(doc: Doc, flavour: string, props: Record<string, unknown>, parent: string) {
  return doc.addBlock(flavour as never, props as never, parent)
}

describe("docMarkdown", () => {
  afterEach(() => {
    cols.splice(0).forEach((col) => col.dispose())
  })

  test("serializes BlockSuite embeds into markdown details", async () => {
    const ctx = page()

    add(
      ctx.doc,
      "affine:embed-youtube",
      {
        url: "https://www.youtube.com/watch?v=clip",
        title: "Tropical House",
        description: "Album cover reference",
        creator: "Channel",
        creatorUrl: "https://youtube.com/@channel",
        videoId: "clip",
        caption: "Watch this",
      },
      ctx.note,
    )

    const out = await docMarkdown(
      ctx.doc,
      opts(async () => new Response(null, { status: 404 })),
    )

    expect(out.text).toContain("[Tropical House](https://www.youtube.com/watch?v=clip)")
    expect(out.text).toContain("- Caption: Watch this")
    expect(out.text).toContain("- Description: Album cover reference")
    expect(out.text).toContain("- Creator: Channel")
    expect(out.text).toContain("- Creator URL: https://youtube.com/@channel")
    expect(out.text).toContain("- Video ID: clip")
    expect(docPlain(ctx.doc)).toContain("Tropical House")
  })

  test("serializes attachments into markdown and assets", async () => {
    const ctx = page()

    add(
      ctx.doc,
      "affine:attachment",
      {
        sourceId: "file_1",
        name: "brief.pdf",
        type: "application/pdf",
        size: 3,
      },
      ctx.note,
    )

    const out = await docMarkdown(
      ctx.doc,
      opts(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "application/pdf" } })),
    )

    expect(out.text).toContain("[brief.pdf](attachment://file_1)")
    expect(out.text).toContain("- Type: application/pdf")
    expect(out.text).toContain("- Size: 3")
    expect(out.assets).toHaveLength(1)
    expect(out.assets[0]).toMatchObject({
      id: "file_1",
      mime: "application/pdf",
      filename: "brief.pdf",
    })
    expect(docPlain(ctx.doc)).toContain("brief.pdf")
  })

  test("serializes rich BlockSuite blocks into markdown", async () => {
    const ctx = page()

    add(ctx.doc, "affine:code", { text: new Text("const value = 1"), language: "ts", caption: "Snippet" }, ctx.note)
    add(ctx.doc, "affine:latex", { latex: "E=mc^2" }, ctx.note)
    add(ctx.doc, "affine:divider", {}, ctx.note)
    add(
      ctx.doc,
      "affine:embed-html",
      { html: '<iframe src="https://example.com"></iframe>', caption: "Demo" },
      ctx.note,
    )

    const out = await docMarkdown(
      ctx.doc,
      opts(async () => new Response(null, { status: 404 })),
    )

    expect(out.text).toContain("Code: Snippet")
    expect(out.text).toContain("```ts\nconst value = 1\n```")
    expect(out.text).toContain("$$\nE=mc^2\n$$")
    expect(out.text).toContain("---")
    expect(out.text).toContain("HTML Embed: Demo")
    expect(out.text).toContain('```html\n<iframe src="https://example.com"></iframe>\n```')
    expect(docPlain(ctx.doc)).toContain("const value = 1")
    expect(docPlain(ctx.doc)).toContain("E=mc^2")
  })
})
