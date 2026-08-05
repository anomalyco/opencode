import { expect, test, type Page } from "@playwright/test"
import {
  assistantMessage,
  sessionID,
  setupTimeline,
  textPart,
  toolPart,
  userMessage,
} from "../performance/timeline-stability/fixture"

const visualizationTool = "visualization_create"
const visualizationTitle = "Choose a layout"
const followUpPrompt = "/not-a-command use compact layout"

test("fails closed on the web without rendering or executing visualization HTML", async ({ page }) => {
  const partID = "prt_visualization_web_disabled"
  const security = await observeVisualizationSecurity(page)
  await setupTimeline(page, {
    protocol: "v2",
    messages: [
      userMessage(),
      assistantMessage([
        toolPart(
          partID,
          visualizationTool,
          "completed",
          {},
          {
            structured: visualization({
              html: `<span>web visualization sentinel</span><script>fetch("https://visualization-e2e.invalid/probe")</script>`,
            }),
          },
        ),
      ]),
    ],
  })

  const tool = page.locator(`[data-timeline-part-id="${partID}"]`)
  await expect(tool.locator('[data-state="invalid"]')).toBeVisible()
  await expect(tool.locator("iframe")).toHaveCount(0)
  await expect(page.getByText("web visualization sentinel", { exact: true })).toHaveCount(0)
  expect(security.externalRequests).toEqual([])
  expect(security.externalResponses).toEqual([])
  expect(security.externalNavigations).toEqual([])
})

test.describe.skip("Desktop visualization integration fixture (requires Electron navigation policy)", () => {
  test("renders a sandboxed visualization and sends its confirmed follow-up as a normal prompt", async ({ page }) => {
    const prompts: { sessionID: string; body: unknown }[] = []
    const partID = "prt_visualization_follow_up"
    await setupTimeline(page, {
      protocol: "v2",
      onPrompt: (input) => prompts.push(input),
      messages: [
        userMessage(),
        assistantMessage([
          toolPart(
            partID,
            visualizationTool,
            "completed",
            {},
            {
              structured: visualization({
                html: `<button id="send">Use compact layout</button>
              <script>
                document.querySelector("#send").onclick = () =>
                  window.opencode.visualization.sendFollowUp({ prompt: ${JSON.stringify(followUpPrompt)} })
              </script>`,
              }),
            },
          ),
        ]),
      ],
    })

    const tool = page.locator(`[data-timeline-part-id="${partID}"]`)
    const frame = tool.locator('[data-slot="visualization-frame"]')
    await expect(frame).toHaveAttribute("sandbox", "allow-scripts")
    await expect(frame).toHaveAttribute("title", visualizationTitle)
    await expect(frame).toHaveAttribute("loading", "lazy")
    await expect(frame).toHaveAttribute("srcdoc", /Use compact layout/)

    const content = page.frameLocator(`[data-timeline-part-id="${partID}"] iframe`)
    await content.getByRole("button", { name: "Use compact layout" }).click()
    const dialog = page.locator('[data-component="dialog"]')
    await expect(dialog).toContainText(visualizationTitle)
    await expect(dialog).toContainText(followUpPrompt)
    await dialog.getByRole("button", { name: "Cancel" }).click()
    await expect(dialog).toHaveCount(0)
    expect(prompts).toEqual([])

    await content.getByRole("button", { name: "Use compact layout" }).click()
    await expect(dialog).toBeVisible()
    await dialog.getByRole("button", { name: "Send" }).click()
    await expect.poll(() => prompts).toHaveLength(1)
    expect(prompts[0]).toMatchObject({ sessionID, body: expect.objectContaining({ text: followUpPrompt }) })
    expect(JSON.stringify(prompts[0]?.body)).not.toContain('"command"')
  })

  test("clamps visualization height while preserving the frame and range state through theme changes", async ({
    page,
  }) => {
    const partID = "prt_visualization_height_theme"
    await setupTimeline(page, {
      protocol: "v2",
      messages: [
        userMessage(),
        assistantMessage([
          toolPart(
            partID,
            visualizationTool,
            "completed",
            {},
            {
              structured: visualization({
                html: `<label>Density <input id="density" type="range" min="0" max="100" value="37"></label>
              <button id="grow">Grow</button><div id="content"></div>
              <script>
                document.querySelector("#grow").onclick = () => {
                  document.querySelector("#content").style.height = "6000px"
                }
              </script>`,
              }),
            },
          ),
        ]),
      ],
    })

    const tool = page.locator(`[data-timeline-part-id="${partID}"]`)
    const frame = tool.locator('[data-slot="visualization-frame"]')
    const content = page.frameLocator(`[data-timeline-part-id="${partID}"] iframe`)
    await content.locator("#density").evaluate((element) => {
      const input = element as HTMLInputElement
      input.value = "73"
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    const identity = await frame.evaluate((element) => {
      const node = element as HTMLIFrameElement & { visualizationE2EIdentity?: string }
      node.visualizationE2EIdentity ??= crypto.randomUUID()
      return node.visualizationE2EIdentity
    })

    await content.getByRole("button", { name: "Grow" }).click()
    const container = tool.locator('[data-slot="visualization-frame-container"]')
    await expect(container).toHaveCSS("height", "720px")
    await tool.getByRole("button", { name: "Expand" }).click()
    await expect(container).toHaveCSS("height", "4096px")

    await page.locator("html").evaluate((element) => element.setAttribute("data-theme", "visualization-e2e"))
    await page.waitForTimeout(100)
    expect(
      await frame.evaluate(
        (element) => (element as HTMLIFrameElement & { visualizationE2EIdentity?: string }).visualizationE2EIdentity,
      ),
    ).toBe(identity)
    await expect(content.locator("#density")).toHaveValue("73")
  })

  test("keeps historical and loading content independent when one visualization result is invalid", async ({
    page,
  }) => {
    const historicalUserID = "msg_visualization_history_user"
    const historicalFrameID = "prt_visualization_history_valid"
    const loadingID = "prt_visualization_loading"
    const validID = "prt_visualization_current_valid"
    const invalidID = "prt_visualization_current_invalid"
    const historicalUser = userMessage(undefined, { id: historicalUserID, created: 1_700_000_000_000 })
    const historicalAssistant = assistantMessage(
      [
        toolPart(
          historicalFrameID,
          visualizationTool,
          "completed",
          {},
          {
            structured: visualization({
              title: "Historical visualization",
              html: `<span>Historical visualization</span>`,
            }),
          },
        ),
      ],
      { id: "msg_visualization_history_assistant", parentID: historicalUserID, created: 1_700_000_001_000 },
    )
    const currentUser = userMessage(undefined, { id: "msg_visualization_current_user", created: 1_700_000_002_000 })
    const currentAssistant = assistantMessage(
      [
        textPart("prt_visualization_plain_text", "Ordinary timeline content remains visible."),
        toolPart(
          invalidID,
          visualizationTool,
          "completed",
          {},
          {
            structured: { version: 2, title: visualizationTitle, html: "<div>Unsupported version</div>" },
          },
        ),
        toolPart(
          validID,
          visualizationTool,
          "completed",
          {},
          {
            structured: visualization({ title: "Current visualization", html: `<span>Current visualization</span>` }),
          },
        ),
        toolPart(loadingID, visualizationTool, "pending", {}),
      ],
      {
        id: "msg_visualization_current_assistant",
        parentID: currentUser.info.id,
        completed: false,
        created: 1_700_000_003_000,
      },
    )
    await setupTimeline(page, {
      protocol: "v2",
      messages: [historicalUser, historicalAssistant, currentUser, currentAssistant],
    })

    await expect(page.locator(`[data-timeline-part-id="${historicalFrameID}"] iframe`)).toBeVisible()
    await expect(page.locator(`[data-timeline-part-id="${validID}"] iframe`)).toBeVisible()
    await expect(page.locator(`[data-timeline-part-id="${invalidID}"] [data-state="invalid"]`)).toBeVisible()
    await expect(page.getByText("Ordinary timeline content remains visible.", { exact: true })).toBeVisible()
    await expect(page.locator(`[data-timeline-part-id="${loadingID}"] [data-state="thinking"]`)).toBeVisible()
  })

  test("isolates visualization scripts from the host, Electron bridge, navigation, downloads, and external network", async ({
    page,
  }) => {
    const partID = "prt_visualization_security"
    const security = await observeVisualizationSecurity(page)

    await setupTimeline(page, {
      protocol: "v2",
      messages: [
        userMessage(),
        assistantMessage([
          toolPart(
            partID,
            visualizationTool,
            "completed",
            {},
            {
              structured: visualization({
                title: "Security probe",
                html: `<button id="attack">Run isolation probe</button><output id="result"></output>
              <script>
                document.querySelector("#attack").onclick = () => {
                  let parentDom = false
                  let api = false
                  try { parent.document.documentElement.setAttribute("data-visualization-attack", "changed"); parentDom = true } catch (_) {}
                  try { parent.api = { changed: true }; api = true } catch (_) {}
                  document.querySelector("#result").textContent = "parent:" + parentDom + " api:" + api
                  const remote = "https://visualization-e2e.invalid/probe"
                  fetch(remote).then(
                    () => { document.body.dataset.fetch = "resolved" },
                    (error) => { document.body.dataset.fetch = error.name + ":" + error.message },
                  )
                  const xhr = new XMLHttpRequest(); xhr.open("GET", remote + "/xhr"); xhr.send()
                  try { new WebSocket("wss://visualization-e2e.invalid/socket") } catch (_) {}
                  const image = new Image(); image.src = remote + "/image"; document.body.append(image)
                  try { window.open(remote + "/popup") } catch (_) {}
                }
              </script>`,
              }),
            },
          ),
        ]),
      ],
    })

    const frame = page.frameLocator(`[data-timeline-part-id="${partID}"] iframe`)
    const main = await page.evaluate(() => ({
      url: location.href,
      bridge: typeof (window as Window & { api?: unknown }).api,
      attack: document.documentElement.getAttribute("data-visualization-attack"),
    }))
    const frameBeforeAttack = await frame.locator("html").evaluate(() => ({
      url: document.URL,
      origin: location.origin,
      csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content"),
    }))
    await frame.getByRole("button", { name: "Run isolation probe" }).click()
    await expect(frame.locator("#result")).toHaveText("parent:false api:false")
    await page.waitForTimeout(500)

    expect(
      security.externalResponses,
      JSON.stringify({
        frame: frameBeforeAttack,
        fetch: await frame.locator("body").evaluate((element) => element.dataset.fetch),
        console: security.console,
      }),
    ).toEqual([])
    expect(security.externalNavigations).toEqual([])
    expect(security.popups).toEqual([])
    expect(security.downloads).toEqual([])
    expect(page.url()).toBe(main.url)
    await expect
      .poll(() =>
        page.evaluate(() => ({
          bridge: typeof (window as Window & { api?: unknown }).api,
          attack: document.documentElement.getAttribute("data-visualization-attack"),
        })),
      )
      .toEqual({ bridge: main.bridge, attack: main.attack })
  })

  for (const probe of [
    {
      name: "form submission",
      script: `const form = document.createElement("form"); form.action = remote + "/form"; document.body.append(form); form.submit()`,
    },
    {
      name: "download",
      script: `const download = document.createElement("a"); download.href = remote + "/download"; download.download = "probe.txt"; document.body.append(download); download.click()`,
    },
    { name: "top navigation", script: `top.location.href = remote + "/top"` },
    { name: "self navigation", script: `location.href = remote + "/self"` },
  ]) {
    test(`blocks visualization ${probe.name}`, async ({ page }) => {
      const partID = `prt_visualization_${probe.name.replaceAll(" ", "_")}`
      const security = await observeVisualizationSecurity(page)
      await setupTimeline(page, {
        protocol: "v2",
        messages: [
          userMessage(),
          assistantMessage([
            toolPart(
              partID,
              visualizationTool,
              "completed",
              {},
              {
                structured: visualization({
                  title: `Security ${probe.name}`,
                  html: `<button id="attack">Run ${probe.name}</button>
                <script>
                  document.querySelector("#attack").onclick = () => {
                    const remote = "https://visualization-e2e.invalid/probe"
                    try { ${probe.script} } catch (_) {}
                  }
                </script>`,
                }),
              },
            ),
          ]),
        ],
      })

      const frame = page.frameLocator(`[data-timeline-part-id="${partID}"] iframe`)
      const mainURL = page.url()
      await frame.getByRole("button", { name: `Run ${probe.name}` }).click()
      await page.waitForTimeout(500)
      expect(security.externalResponses).toEqual([])
      expect(security.externalNavigations).toEqual([])
      expect(security.popups).toEqual([])
      expect(security.downloads).toEqual([])
      expect(page.url()).toBe(mainURL)
      await expect(frame.getByRole("button", { name: `Run ${probe.name}` })).toBeVisible()
    })
  }
})

function visualization(input: { title?: string; html: string }) {
  return { version: 1, title: input.title ?? visualizationTitle, html: input.html }
}

async function observeVisualizationSecurity(page: Page) {
  const externalRequests: { url: string; resourceType: string; navigation: boolean }[] = []
  const externalResponses: { url: string; status: number }[] = []
  const externalNavigations: string[] = []
  const popups: string[] = []
  const downloads: string[] = []
  const console: { type: string; text: string; url: string }[] = []
  const appOrigin = new URL(
    process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? "3000"}`,
  ).origin
  const serverOrigin = `http://${process.env.PLAYWRIGHT_SERVER_HOST ?? "127.0.0.1"}:${process.env.PLAYWRIGHT_SERVER_PORT ?? "4096"}`
  const isExternal = (url: string) => {
    const parsed = new URL(url)
    return (
      ["http:", "https:", "ws:", "wss:"].includes(parsed.protocol) &&
      parsed.origin !== appOrigin &&
      parsed.origin !== serverOrigin
    )
  }

  page.on("request", (request) => {
    if (isExternal(request.url())) {
      externalRequests.push({
        url: request.url(),
        resourceType: request.resourceType(),
        navigation: request.isNavigationRequest(),
      })
    }
  })
  page.on("console", (message) => {
    if (message.type() !== "error") return
    console.push({ type: message.type(), text: message.text(), url: message.location().url })
  })
  page.on("response", (response) => {
    if (isExternal(response.url())) externalResponses.push({ url: response.url(), status: response.status() })
  })
  page.on("framenavigated", (frame) => {
    if (isExternal(frame.url())) externalNavigations.push(frame.url())
  })
  page.context().on("page", (popup) => {
    popups.push(popup.url())
    void popup.close()
  })
  page.on("download", (download) => downloads.push(download.suggestedFilename()))
  await page.route("**/*", async (route) => {
    if (isExternal(route.request().url())) return route.abort()
    return route.fallback()
  })

  return { externalRequests, externalResponses, externalNavigations, popups, downloads, console }
}
