import { afterEach, expect, test } from "bun:test"
import { ImageRenderable, SyntaxStyle, type Renderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { render } from "@opentui/solid"
import { createMarkdownImageRenderer, createMarkdownImages } from "../src/routes/session/markdown-image"
import { diffImageFixture } from "./fixture/diff-image"

const renderers: Awaited<ReturnType<typeof createTestRenderer>>["renderer"][] = []
const syntaxStyle = SyntaxStyle.fromStyles({ default: { fg: "#ffffff" } })

afterEach(() => {
  renderers.splice(0).forEach((renderer) => renderer.destroy())
})

async function renderMarkdown(content: string, read: Parameters<typeof createMarkdownImages>[0]["read"]) {
  const images = createMarkdownImages({ read, directory: () => "/srv/app" })
  const opened: string[] = []
  const output = await createTestRenderer({ width: 60, height: 20, remote: true, useThread: false })
  await render(
    () => (
      <markdown
        syntaxStyle={syntaxStyle}
        content={content}
        streaming={false}
        conceal={true}
        internalBlockMode="top-level"
        renderNode={createMarkdownImageRenderer({
          renderer: output.renderer,
          images,
          base: undefined,
          maxHeight: () => 6,
          open: (_, alt) => opened.push(alt),
        })}
      />
    ),
    output.renderer,
  )
  renderers.push(output.renderer)
  output.renderer.start()
  return { output, opened }
}

function findImages(node: Renderable): ImageRenderable[] {
  if (node instanceof ImageRenderable) return [node]
  return node.getChildren().flatMap(findImages)
}

test("reads local images through the session location and fits them", async () => {
  const requests: unknown[] = []
  const { output } = await renderMarkdown(
    "Intro\n\n![Sunset](docs/sunset.png)\n\n![Plot](/tmp/plot.png)",
    async (request) => {
      requests.push(request)
      return diffImageFixture
    },
  )
  await output.waitFor(() => findImages(output.renderer.root).every((image) => image.height === 6))
  const frame = await output.waitForFrame((frame) => frame.includes("Intro"))

  expect(requests).toEqual([
    { path: "docs/sunset.png", location: { directory: "/srv/app" } },
    { path: "plot.png", location: { directory: "/tmp/" } },
  ])
  expect(findImages(output.renderer.root)).toHaveLength(2)
  expect(frame).not.toContain("Sunset")
})

test("keeps text paragraphs and remote images unchanged", async () => {
  const requests: unknown[] = []
  const { output } = await renderMarkdown("See ![chart](https://example.com/chart.png) here", async (request) => {
    requests.push(request)
    return diffImageFixture
  })
  await output.waitForFrame((frame) => frame.includes("See chart here"))

  expect(requests).toEqual([])
  expect(findImages(output.renderer.root)).toEqual([])
})

test("shows the alt text when an image cannot be read", async () => {
  const { output } = await renderMarkdown("![Missing diagram](docs/missing.png)", () =>
    Promise.reject(new Error("not found")),
  )
  await output.waitForFrame((frame) => frame.includes("Missing diagram"))

  expect(findImages(output.renderer.root).every((image) => !image.visible)).toBe(true)
})

test("opens the preview when an image is clicked", async () => {
  const { output, opened } = await renderMarkdown("![Sunset](docs/sunset.png)", async () => diffImageFixture)
  await output.waitFor(() => findImages(output.renderer.root)[0]?.height === 6)
  const image = findImages(output.renderer.root)[0]!
  await output.renderOnce()
  await output.mockMouse.click(image.x + 1, image.y + 1)

  expect(opened).toEqual(["Sunset"])
})
