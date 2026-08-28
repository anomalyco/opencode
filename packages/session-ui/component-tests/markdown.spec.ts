import { fileURLToPath } from "node:url"
import { expect, story } from "../../storybook/playwright/story"

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4ioAAAAASUVORK5CYII=",
  "base64",
)

const fixture = `/@fs/${fileURLToPath(new URL("./markdown.fixture.tsx", import.meta.url)).replaceAll("\\", "/")}`

story.beforeEach(async ({ mount }) => {
  const root = await mount("components-markdown--complete-response")
  await expect(root.locator('[data-component="markdown"]')).toHaveAttribute("data-markdown-ready", "")
})

story("sanitizes raw HTML while preserving supported Markdown markup", async ({ page }) => {
  const result = await page.evaluate(async (fixture) => {
    const { sanitizeMarkdown } = await import(fixture)
    return [
      "<p><strong>Safe</strong> <em>formatting</em> <code>const x = 1</code></p>",
      '<script>alert(1)</script><style>body { display: none }</style><img src="safe.png" onerror="alert(2)"><a href="java&#x73;cript:alert(3)">unsafe</a>',
      '<a href="https://example.com" target="_blank" rel="nofollow">external</a><a href="/local">local</a>',
      '<form id="location" name="document"><input name="cookie"></form>',
      "<math><mrow><mi>x</mi><mo>+</mo><mn>1</mn></mrow></math>",
      '<svg viewBox="0 0 10 10"><path d="M0 0L10 10" onload="alert(4)"></path><script>alert(5)</script></svg>',
    ].map(sanitizeMarkdown)
  }, fixture)
  expect(result).toEqual([
    "<p><strong>Safe</strong> <em>formatting</em> <code>const x = 1</code></p>",
    '<img data-local-image="safe.png"><a>unsafe</a>',
    '<a href="https://example.com" target="_blank" rel="nofollow noopener noreferrer">external</a><a href="/local">local</a>',
    '<form name="user-content-document" id="user-content-location"><input name="user-content-cookie"></form>',
    "<math><mrow><mi>x</mi><mo>+</mo><mn>1</mn></mrow></math>",
    '<svg viewBox="0 0 10 10"><path d="M0 0L10 10"></path></svg>',
  ])
})

story("keeps Markdown sanitization and link protections after Mermaid renders", async ({ page }) => {
  const result = await page.evaluate(async (fixture) => {
    const { renderMermaidSvg, sanitizeMarkdown } = await import(fixture)
    const html =
      '<a href="https://example.com" target="_blank" rel="nofollow">external</a><img src="safe.png" onerror="alert(1)">'
    const before = sanitizeMarkdown(html)
    const renders = []
    for (const source of [
      "flowchart LR\n A[Start] --> B[End]",
      "sequenceDiagram\n Alice->>Bob: Hello",
      '%%{init: {"flowchart": {"htmlLabels": true}}}%%\nflowchart LR\n A["<a href=\'https://example.com\' target=\'_blank\'>External</a>"] --> B[End]',
    ]) {
      const svg = await renderMermaidSvg(source)
      const document = new DOMParser().parseFromString(svg, "image/svg+xml")
      renders.push({
        root: document.documentElement.localName,
        text: document.documentElement.textContent,
        unsafe: document.querySelectorAll('script, [onerror], [onload], [href^="javascript:"]').length,
        links: Array.from(document.querySelectorAll("a")).map((link) => ({
          href: link.getAttribute("href"),
          target: link.getAttribute("target"),
          rel: link.getAttribute("rel"),
        })),
        markdown: sanitizeMarkdown(html),
      })
    }
    return {
      before,
      renders,
      invalid: await renderMermaidSvg("not a diagram"),
      afterInvalid: sanitizeMarkdown(html),
    }
  }, fixture)
  expect(result.before).toBe(
    '<a href="https://example.com" target="_blank" rel="nofollow noopener noreferrer">external</a><img data-local-image="safe.png">',
  )
  expect(result.renders).toEqual([
    { root: "svg", text: expect.stringContaining("Start"), unsafe: 0, links: [], markdown: result.before },
    { root: "svg", text: expect.stringContaining("Hello"), unsafe: 0, links: [], markdown: result.before },
    {
      root: "svg",
      text: expect.stringContaining("External"),
      unsafe: 0,
      links: [{ href: "https://example.com", target: "_blank", rel: "noopener" }],
      markdown: result.before,
    },
  ])
  expect(result.invalid).toBeUndefined()
  expect(result.afterInvalid).toBe(result.before)
})

story("mounts cached completed Markdown with sanitized HTML and decorations", async ({ page }) => {
  await page.evaluate(
    async ({ fixture, text }) => {
      const { mountMarkdown } = await import(fixture)
      await mountMarkdown({ text, cached: true })
    },
    {
      fixture,
      text: [
        "# Completed response",
        "`src/file.ts` and `https://example.com/docs` and [link](https://example.com)",
        '<img src="missing" onerror="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)">unsafe</a>',
        "```ts\nconst answer = 42\n```",
      ].join("\n\n"),
    },
  )
  const harness = page.getByTestId("markdown-fixture")
  const markdown = harness.locator('[data-component="markdown"]')
  await expect(markdown).toHaveAttribute("data-markdown-ready", "")
  await expect(markdown.getByRole("heading")).toHaveText("Completed response")
  await expect(markdown.locator("script, [onerror], [href^='javascript:']")).toHaveCount(0)
  await expect(markdown.locator('code[data-inline-code-kind="path"]')).toHaveText("src/file.ts")
  await expect(markdown.getByRole("link", { name: "https://example.com/docs" })).toHaveAttribute("target", "_blank")
  await expect(markdown.getByRole("link", { name: "https://example.com/docs" })).toHaveAttribute(
    "rel",
    "noopener noreferrer",
  )
  await expect(markdown.locator("pre code")).toContainText("const answer = 42")
  await expect(markdown.getByRole("button", { name: "Copy", exact: true })).toBeVisible()
  await expect(markdown.locator("[data-markdown-word]")).toHaveCount(0)

  await harness.getByLabel("Markdown text").fill("## Replacement\n\n`new/file.ts`")
  await expect(markdown.getByRole("heading")).toHaveText("Replacement")
  await expect(markdown).toHaveAttribute("data-markdown-ready", "")
  await expect(markdown.locator("pre, h1, a")).toHaveCount(0)
  await expect(markdown.locator('code[data-inline-code-kind="path"]')).toHaveText("new/file.ts")
  await harness.getByRole("button", { name: "Toggle Markdown" }).click()
  await expect(markdown).toHaveCount(0)
  await harness.getByRole("button", { name: "Toggle Markdown" }).click()
  await expect(markdown.getByRole("heading")).toHaveText("Replacement")
  await expect(markdown).toHaveAttribute("data-markdown-ready", "")
  await harness.getByLabel("Markdown text").fill("")
  await expect(markdown).toBeEmpty()
  await expect(markdown).toHaveAttribute("data-markdown-ready", "")
})

story("renders cached Mermaid blocks and falls back to code for invalid diagrams", async ({ page }) => {
  await page.evaluate(async (fixture) => {
    const { mountMarkdown } = await import(fixture)
    await mountMarkdown({ text: "```mermaid\nflowchart LR\n A[Start] --> B[End]\n```", cached: true })
  }, fixture)
  const harness = page.getByTestId("markdown-fixture")
  const markdown = harness.locator('[data-component="markdown"]')
  await expect(markdown.locator('[data-component="markdown-mermaid"] > svg')).toBeVisible()
  await harness.getByRole("button", { name: "Toggle Markdown" }).click()
  await expect(markdown).toHaveCount(0)
  await harness.getByRole("button", { name: "Toggle Markdown" }).click()
  await expect(markdown.locator('[data-component="markdown-mermaid"] > svg')).toBeVisible()
  await harness.getByLabel("Markdown text").fill("```mermaid\nnot a diagram\n```")
  await expect(markdown.locator('[data-component="markdown-mermaid"]')).toHaveCount(0)
  await expect(markdown.locator("pre code")).toBeVisible()
  await expect(markdown.locator("pre code")).toHaveText("not a diagram")
  await expect(markdown.getByRole("button", { name: "Copy", exact: true })).toBeVisible()
})

story("keeps live elements and selection when a stream completes and later changes", async ({ page }) => {
  await page.evaluate(async (fixture) => {
    const { mountMarkdown } = await import(fixture)
    await mountMarkdown({ text: "Hello **world**", streaming: true })
  }, fixture)
  const harness = page.getByTestId("markdown-fixture")
  const markdown = harness.locator('[data-component="markdown"]')
  const paragraph = markdown.locator("p")
  await expect(markdown.locator("[data-markdown-word]")).toHaveCount(2)
  await paragraph.evaluate((element) => element.setAttribute("data-retained", "true"))
  await harness.getByLabel("Markdown text").fill("Hello **world** again")
  await expect(markdown.locator("[data-markdown-word]")).toHaveCount(3)
  await expect(paragraph).toHaveAttribute("data-retained", "true")
  await expect(markdown.locator("[data-markdown-enter]")).not.toHaveCount(0)
  await paragraph.evaluate((element) => {
    const range = document.createRange()
    range.selectNodeContents(element.querySelector("strong")!)
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)
    // Change the control without moving browser focus or selection.
    const input = document.querySelector<HTMLInputElement>('[data-testid="markdown-fixture"] input')!
    input.checked = false
    input.dispatchEvent(new Event("change", { bubbles: true }))
  })
  await expect(harness.getByLabel("Streaming")).not.toBeChecked()
  await expect(markdown).toHaveAttribute("data-markdown-ready", "")
  await expect(paragraph).toHaveAttribute("data-retained", "true")
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("world")
  await harness.getByLabel("Markdown text").fill("Changed **content**")
  await expect(paragraph).toHaveText("Changed content")
  await expect(paragraph).toHaveAttribute("data-retained", "true")
  await expect(markdown.locator("[data-markdown-word]")).toHaveCount(0)
  await harness.getByRole("button", { name: "Toggle Markdown" }).click()
  await expect(markdown).toHaveCount(0)
})

story("replaces completed DOM before live rendering and retains streamed code copy actions", async ({ page }) => {
  await page.evaluate(async (fixture) => {
    const { mountMarkdown } = await import(fixture)
    await mountMarkdown({ text: "Initial **content**" })
  }, fixture)
  const harness = page.getByTestId("markdown-fixture")
  const markdown = harness.locator('[data-component="markdown"]')
  await expect(markdown.locator("p")).toHaveText("Initial content")
  await harness.getByLabel("Streaming").check()
  await harness.getByLabel("Markdown text").fill("Initial **content** continues")
  await expect(markdown.locator("p")).toHaveCount(1)
  await expect(markdown.locator("[data-markdown-word]")).toHaveCount(3)
  await harness.getByLabel("Markdown text").fill("```sh\necho hello\n")
  await expect(markdown.locator("pre code")).toHaveText("echo hello\n")
  await expect(markdown.locator("p")).toHaveCount(0)
  await expect(markdown.locator('[data-component="markdown-code"]')).toHaveAttribute("data-code-kind", "shell")
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"])
  await markdown.getByRole("button", { name: "Copy" }).click()
  await expect(markdown.getByRole("button", { name: "Copied" })).toBeVisible()
  expect((await page.evaluate(() => navigator.clipboard.readText())).replaceAll("\r\n", "\n")).toBe("echo hello\n")
  await harness.getByLabel("Streaming").uncheck()
  await expect(markdown.locator("[data-markdown-complete]")).toHaveAttribute("data-markdown-complete", "true")
  await expect(markdown.locator("pre code")).toHaveText("echo hello\n")
  await harness.getByLabel("Markdown text").fill("Replacement prose")
  await expect(markdown.locator("p")).toHaveText("Replacement prose")
  await expect(markdown.locator('pre, [data-slot="markdown-copy-button"]')).toHaveCount(0)
  await harness.getByRole("button", { name: "Toggle Markdown" }).click()
  await expect(markdown).toHaveCount(0)
})

story("highlights streamed code across comment and string boundaries", async ({ page }) => {
  await page.evaluate(async (fixture) => {
    const { mountMarkdown } = await import(fixture)
    await mountMarkdown({ text: "```ts\n", streaming: true })
  }, fixture)
  const harness = page.getByTestId("markdown-fixture")
  const markdown = harness.locator('[data-component="markdown"]')
  const code = markdown.locator("pre code")
  const chunks = ["/* multi", "line\ncomment *", "/\nconst message = `hel", "lo ${1 + 2}`\n", "const pattern = /a+b/g"]
  for (let index = 1; index <= chunks.length; index++) {
    const text = chunks.slice(0, index).join("")
    await harness.getByLabel("Markdown text").fill(`\`\`\`ts\n${text}`)
    await expect(code).toHaveText(text)
  }
  await expect(code.locator('span[style*="color"]')).not.toHaveCount(0)
  await harness.getByLabel("Markdown text").fill(`\`\`\`ts\n${chunks.join("")}\n\`\`\``)
  await harness.getByLabel("Streaming").uncheck()
  await expect(markdown.locator("[data-markdown-complete]")).toHaveAttribute("data-markdown-complete", "true")
  await expect(code).toHaveText(chunks.join(""))
  await expect(code).toContainText("const pattern = /a+b/g")
  expect(
    await code
      .locator("span[style]")
      .evaluateAll((spans) => new Set(spans.map((span) => getComputedStyle(span).color)).size),
  ).toBeGreaterThan(1)
  await harness.getByRole("button", { name: "Toggle Markdown" }).click()
  await harness.getByRole("button", { name: "Toggle Markdown" }).click()
  await expect(code).toHaveText(chunks.join(""))
  await expect(code.locator('span[style*="color"]')).not.toHaveCount(0)
  await harness.getByLabel("Markdown text").fill("```unknown-language\n<plain> & text\n```")
  await expect(code).toHaveText("<plain> & text")
  await expect(code.locator("plain")).toHaveCount(0)
})

story("preserves streamed math through completion and a fresh render", async ({ page }) => {
  await page.evaluate(async (fixture) => {
    const { mountMarkdown } = await import(fixture)
    await mountMarkdown({ text: "Formula: \\(P(x_{t+1})\\)", streaming: true })
  }, fixture)
  const harness = page.getByTestId("markdown-fixture")
  const markdown = harness.locator('[data-component="markdown"]')
  await expect(markdown.locator(".katex")).toHaveCount(1)
  await expect(markdown.locator(".katex-mathml")).toContainText("P(x_{t+1})")
  expect(await markdown.locator(".katex").evaluate((element) => element.nextSibling?.textContent ?? "")).toBe("")
  await harness.getByLabel("Markdown text").fill("Formula: \\(P(x_{t+1})\\) and \\(w^{*}\\).\n\n$$\nx^2 + y^2\n$$\n")
  await expect(markdown.locator(".katex")).toHaveCount(3)
  await expect(markdown.locator(".katex-display")).toHaveCount(1)
  await expect(markdown.locator(".katex-mathml")).toContainText(["P(x_{t+1})", "w^{*}", "x^2 + y^2"])
  await expect(markdown.locator(".katex-error, em, strong")).toHaveCount(0)
  await harness.getByLabel("Streaming").uncheck()
  await expect(markdown.locator(".katex")).toHaveCount(3)
  await harness.getByRole("button", { name: "Toggle Markdown" }).click()
  await harness.getByRole("button", { name: "Toggle Markdown" }).click()
  await expect(markdown.locator(".katex")).toHaveCount(3)
  await expect(markdown.locator(".katex-display")).toHaveCount(1)
  await expect(markdown.locator(".katex-error")).toHaveCount(0)
})

for (const theme of ["light", "dark"]) {
  for (const width of [390, 1280]) {
    story(`renders class and connected subgraph diagrams in ${theme} at ${width}px`, async ({ mount, page }) => {
      await page.setViewportSize({ width, height: 900 })
      await mount("components-markdown--complete-response", { globals: { theme } })
      await expect(page.locator("html")).toHaveClass(new RegExp(theme))
      await page.evaluate(async (fixture) => {
        const { mountMarkdown } = await import(fixture)
        await mountMarkdown({
          text: [
            "```mermaid\nclassDiagram\nAnimal <|-- Duck\nAnimal : +int age\nDuck : +swim()\n```",
            "```mermaid\nflowchart LR\nsubgraph Input\ndirection TB\nA[Prompt] --> B[Parse]\nend\nsubgraph Output\ndirection TB\nC[Render] --> D[Display]\nend\nB --> C\n```",
          ].join("\n\n"),
          streaming: true,
        })
      }, fixture)
      const harness = page.getByTestId("markdown-fixture")
      const diagrams = harness.locator('[data-component="markdown-mermaid"] > svg')
      await expect(diagrams).toHaveCount(2)
      await expect(diagrams.nth(0)).toBeVisible()
      await expect(diagrams.nth(0)).toContainText("swim()")
      await expect(diagrams.nth(1)).toBeVisible()
      await expect(diagrams.nth(1)).toContainText("Display")
      await expect(diagrams.nth(1).locator(".edgePaths path")).toHaveCount(3)
      await expect(harness.locator('[data-mermaid-ready="true"] > pre:visible')).toHaveCount(0)
      await harness.getByLabel("Streaming").uncheck()
      await expect(diagrams).toHaveCount(2)
      await expect(diagrams.nth(0)).toBeVisible()
      await expect(diagrams.nth(1)).toBeVisible()
    })
  }
}

for (const streaming of [false, true]) {
  story(
    `loads local images in ${streaming ? "streaming" : "cached"} Markdown and releases their URLs`,
    async ({ page }) => {
      const requests: string[] = []
      await page.route("**/api/fs/read/**", async (route) => {
        expect(route.request().headers().authorization).toBe(
          `Basic ${Buffer.from("opencode:fixture").toString("base64")}`,
        )
        requests.push(route.request().url())
        await route.fulfill({ contentType: "image/png", body: png })
      })
      await page.evaluate(
        async ({ fixture, streaming }) => {
          const { mountMarkdown } = await import(fixture)
          await mountMarkdown({
            text: "![Chart](C:/tmp/chart%20one.png)\n\n![Again](C:/tmp/chart%20one.png)",
            streaming,
            cached: !streaming,
            images: true,
          })
        },
        { fixture, streaming },
      )
      const harness = page.getByTestId("markdown-fixture")
      const image = harness.getByRole("img", { name: "Chart", exact: true })
      await expect.poll(() => image.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1)
      await expect(harness.getByRole("img", { name: "Again", exact: true })).toHaveAttribute("src", /^blob:/)
      expect(requests).toHaveLength(1)
      expect(new URL(requests[0]).searchParams.get("location[directory]")).toBe("C:/tmp/")
      const url = await image.getAttribute("src")
      await harness.getByLabel("Streaming").uncheck()
      await expect(harness.locator('[data-component="markdown"]')).toHaveAttribute("data-markdown-ready", "")
      await expect(image).toHaveAttribute("src", url!)
      await harness.getByLabel("Markdown text").fill("![Replacement](./images/next.png)")
      await expect
        .poll(() =>
          harness.getByRole("img", { name: "Replacement" }).evaluate((image: HTMLImageElement) => image.naturalWidth),
        )
        .toBe(1)
      expect(requests).toHaveLength(2)
      expect(
        await page.evaluate(
          (url) =>
            fetch(url!).then(
              () => false,
              () => true,
            ),
          url,
        ),
      ).toBe(true)
      const next = await harness.getByRole("img", { name: "Replacement" }).getAttribute("src")
      await harness.getByRole("button", { name: "Toggle Markdown" }).click()
      await expect(harness.getByRole("img")).toHaveCount(0)
      expect(
        await page.evaluate(
          (url) =>
            fetch(url!).then(
              () => false,
              () => true,
            ),
          next,
        ),
      ).toBe(true)
    },
  )
}

story("keeps remote images browser-owned and rejects unsafe image sources", async ({ page }) => {
  await page.route("https://images.example/chart.png", (route) => {
    expect(route.request().headers().authorization).toBeUndefined()
    return route.fulfill({ contentType: "image/png", body: png })
  })
  await page.evaluate(async (fixture) => {
    const { mountMarkdown } = await import(fixture)
    await mountMarkdown({
      images: true,
      text: '<img alt="Remote" src="https://images.example/chart.png"><img alt="Unsafe" src="javascript:alert(1)" onerror="alert(2)" data-local-image="/tmp/forged.png">',
    })
  }, fixture)
  const harness = page.getByTestId("markdown-fixture")
  await expect
    .poll(() => harness.getByRole("img", { name: "Remote" }).evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBe(1)
  await expect(harness.getByRole("img", { name: "Remote" })).toHaveAttribute("src", "https://images.example/chart.png")
  await expect(harness.locator("[onerror], [src^='javascript:'], [data-local-image]")).toHaveCount(0)
})

story("keeps scripts and external resources inactive inside local SVG images", async ({ page }) => {
  const external: string[] = []
  await page.context().route("https://images.example/**", async (route) => {
    external.push(route.request().url())
    await route.abort()
  })
  await page.route("**/api/fs/read/chart.svg?*", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">
        <script>parent.document.title = "image-script-ran"; fetch("https://images.example/script")</script>
        <image href="https://images.example/nested.png" width="32" height="32" />
        <rect width="32" height="32" fill="green" />
      </svg>`,
    }),
  )
  await page.evaluate(async (fixture) => {
    const { mountMarkdown } = await import(fixture)
    await mountMarkdown({ images: true, text: "![SVG](Z:/charts/chart.svg)" })
  }, fixture)
  const image = page.getByTestId("markdown-fixture").getByRole("img", { name: "SVG" })
  await expect.poll(() => image.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(32)
  await expect(image).toHaveAttribute("src", /^data:image\/svg\+xml;/)
  await expect(page).not.toHaveTitle("image-script-ran")
  expect(external).toEqual([])
  // Opening an image as a document must not give its contents the app's origin.
  const preview = await page.context().newPage()
  await preview.goto((await image.getAttribute("src"))!)
  expect(await preview.evaluate(() => location.origin)).toBe("null")
  await preview.close()
})

story("loads file URLs and leaves unreadable images as alt text", async ({ page }) => {
  const requested = new Set<string>()
  await page.route("**/api/fs/read/**", async (route) => {
    const url = new URL(route.request().url())
    requested.add(url.pathname)
    await route.fulfill(
      url.pathname.endsWith("missing.png")
        ? { status: 404, body: "Not found" }
        : { contentType: "image/png", body: png },
    )
  })
  await page.evaluate(async (fixture) => {
    const { mountMarkdown } = await import(fixture)
    await mountMarkdown({
      images: true,
      text: "![Available](file:///C:/tmp/chart%25.png)\n\n![Unavailable](file:///tmp/missing.png)",
    })
  }, fixture)
  const harness = page.getByTestId("markdown-fixture")
  await expect
    .poll(() =>
      harness
        .getByRole("img", { name: "Available", exact: true })
        .evaluate((image: HTMLImageElement) => image.naturalWidth),
    )
    .toBe(1)
  await expect.poll(() => [...requested].sort()).toEqual(["/api/fs/read/chart%25.png", "/api/fs/read/missing.png"])
  await expect(harness.getByRole("img", { name: "Unavailable" })).not.toHaveAttribute("src")
  await harness.getByLabel("Markdown text").fill("Still usable")
  await expect(harness.locator('[data-component="markdown"]')).toHaveText("Still usable")
})
