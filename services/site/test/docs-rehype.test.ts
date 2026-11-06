import { describe, expect, test } from "bun:test"
import type { Element, ElementContent, Root } from "hast"
import { toText } from "hast-util-to-text"
import { VFile } from "vfile"
import rehypeHeadings from "~/docs/rehype-headings"
import rehypeShiki from "~/docs/rehype-shiki"

// The MDX components rehype-shiki.ts and rehype-headings.ts put in the tree, as MDX compiles them.
type Jsx = { type: string; name: string; attributes: { name: string; value: string }[]; children: ElementContent[] }
const attributes = (node: Jsx) => Object.fromEntries(node.attributes.map((item) => [item.name, item.value]))

async function fence(lang: string, text: string, meta?: string) {
  const code: Element = {
    type: "element",
    tagName: "code",
    properties: { className: [`language-${lang}`] },
    children: [{ type: "text", value: `${text}\n` }],
    data: meta ? ({ meta } as Element["data"]) : undefined,
  }
  const tree: Root = { type: "root", children: [{ type: "element", tagName: "pre", properties: {}, children: [code] }] }
  await rehypeShiki()(tree)
  return tree.children[0] as unknown as Jsx
}

describe("docs code frames", () => {
  test("a shell session copies its commands, without the prompts or the output", async () => {
    const frame = await fence("bash", "$ opencode pair\nPairing code: 123456\n$ opencode service status")
    expect(frame.name).toBe("CodeFrame")
    expect(attributes(frame)).toMatchObject({
      variant: "terminal",
      kind: "terminal",
      label: "Terminal",
      copy: "$ opencode pair\n$ opencode service status",
    })
    const pre = frame.children[0] as Element
    expect(toText(pre, { whitespace: "pre" })).toBe("$ opencode pair\nPairing code: 123456\n$ opencode service status")
    const tokens = (pre.children[0] as Element).children.flatMap((node) =>
      node.type === "element" ? [node.properties.dataToken] : [],
    )
    expect(tokens).toEqual(["prompt", "output", "prompt"])
  })

  test("a titled block names its file, with the file's icon, and other titles stay plain labels", async () => {
    expect(attributes(await fence("jsonc", "{}", 'title="opencode.jsonc"'))).toMatchObject({
      variant: "codeTitle",
      kind: "file",
      label: "opencode.jsonc",
      copy: "{}",
    })
    expect(attributes(await fence("json", "{}", 'title="theme.json (excerpt)"'))).toMatchObject({
      kind: "file",
      label: "theme.json (excerpt)",
      file: "theme.json",
    })
    expect(attributes(await fence("jsonc", "{}", 'title="Inside base"'))).toMatchObject({
      variant: "codeTitle",
      kind: "code",
      label: "Inside base",
    })
    expect(attributes(await fence("ts", "const a = 1"))).toMatchObject({ variant: "code", label: "TypeScript" })
  })

  test("a box-drawn tree in a text block is the site's file tree, with nothing to copy", async () => {
    const frame = await fence("text", ".opencode/\n└── plugins/\n    └── concise.ts")
    expect(attributes(frame)).toEqual({ variant: "fileTree", kind: "tree", label: "Files" })
    const tree = frame.children[0] as unknown as Jsx
    expect(tree.name).toBe("FileTree")
    expect(attributes(tree).tree).toBe(".opencode/\n└── plugins/\n    └── concise.ts")
  })

  test("a diff copies the result, without the removed lines", async () => {
    const frame = await fence("diff", ' {\n-  "bash": "allow"\n+  "bash": "ask"\n }')
    expect(attributes(frame)).toMatchObject({ variant: "codeDiff", copy: '{\n  "bash": "ask"\n}' })
  })
})

describe("docs headings", () => {
  test("keep their ids and wrap h2 and h3 in the link that copies their address", () => {
    const heading = (tagName: string, text: string): Element => ({
      type: "element",
      tagName,
      properties: {},
      children: [{ type: "text", value: text }],
    })
    const tree: Root = { type: "root", children: [heading("h2", "Local models"), heading("h4", "Ollama")] }
    const file = new VFile()
    rehypeHeadings()(tree, file)
    const [h2, h4] = tree.children as Element[]
    expect(h2.properties.id).toBe("local-models")
    expect((h2.children[0] as unknown as Jsx).name).toBe("HeadingLink")
    expect(attributes(h2.children[0] as unknown as Jsx)).toEqual({ id: "local-models", title: "Local models" })
    expect(h4.children[0]).toEqual({ type: "text", value: "Ollama" })
    expect(file.data.headings).toEqual([
      { depth: 2, slug: "local-models", text: "Local models" },
      { depth: 4, slug: "ollama", text: "Ollama" },
    ])
  })
})
