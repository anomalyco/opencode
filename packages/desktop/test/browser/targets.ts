import assert from "node:assert/strict"
import type { BrowserWindow } from "electron"
import { Browser } from "@opencode-ai/plugin-browser/rpc"
import { Schema } from "effect"
import { createBrowserPage } from "../../src/main/browser-chromium"
import { createCornerImages } from "../../src/main/browser/corners"

export async function verifyTargets(win: BrowserWindow, url: string) {
  const children = win.contentView.children.length
  const tabID = Browser.TabID.make(`tab_${crypto.randomUUID()}`)
  const page = createBrowserPage(win, {
    id: tabID,
    partition: `target-test-${crypto.randomUUID()}`,
    publish() {},
    fail() {
      throw new Error("Target test page failed")
    },
    popup() {
      throw new Error("Unexpected popup")
    },
  })
  const execute = (action: Browser.Action, target?: Browser.Target) =>
    page.execute({ action, files: [], target }, new AbortController().signal)
  const inspect = async (action: Browser.Action) => {
    const result = await page.execute({ action, files: [], inspect: true }, new AbortController().signal)
    assert.equal(result.files.length, 0)
    return Schema.decodeUnknownSync(Browser.Target)(result.value)
  }
  try {
    await page.ready
    for (const color of [
      [255, 255, 255, 255],
      [20, 24, 30, 255],
      [40, 100, 160, 255],
    ] as const) {
      const images = createCornerImages(color, 10, 1)
      const left = images[0].toBitmap()
      const right = images[1].toBitmap()
      assert.deepEqual([...left.subarray(9 * 10 * 4, 9 * 10 * 4 + 4)], [color[2], color[1], color[0], 255])
      assert.equal(left[9 * 4 + 3], 0)
      assert.equal(right[3], 0)
      assert.equal(right[(10 * 10 - 1) * 4 + 3], 255)
    }
    for (const bounds of [
      { x: 30, y: 40, width: 500, height: 300 },
      { x: 50, y: 60, width: 600, height: 400 },
    ]) {
      page.layout(bounds, [255, 255, 255, 255], 10)
      page.setVisible(true)
      await page.contents.executeJavaScript(
        "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(null))))",
      )
      assert.deepEqual(page.view.getBounds(), bounds)
      assert.deepEqual(await page.contents.executeJavaScript("({width:innerWidth,height:innerHeight})"), {
        width: bounds.width,
        height: bounds.height,
      })
      assert.equal(win.contentView.children.length, children + 3)
      page.setVisible(false)
      assert(win.contentView.children.slice(children).every((view) => !view.getVisible()))
    }
    await execute({ type: "navigate", tabID, url })
    const frameURL = new URL("/frame", url.replace("127.0.0.1", "localhost")).href
    await execute({
      type: "evaluate",
      tabID,
      script: `new Promise(resolve => { const frame = document.querySelector('iframe'); frame.onload = () => resolve(null); frame.src = ${JSON.stringify(frameURL)}; })`,
    })
    const operation = Browser.Operations.find((op) => op.name === "frames")
    assert(operation)
    const listing = Schema.decodeUnknownSync(operation.output)((await execute({ type: "frames", tabID })).value)
    const frame = listing.frames.find((frame) => frame.url === frameURL)
    assert(frame)
    const frameID = frame.id
    const evaluation: Browser.Action = { type: "evaluate", tabID, frameID, script: "document.body.innerText" }
    assert.deepEqual((await inspect(evaluation)).resources, [frameURL])
    const snapshot = await execute({ type: "snapshot", tabID, frameID })
    const content = Schema.decodeUnknownSync(Schema.Struct({ content: Schema.String }))(snapshot.value).content
    const ref = content.match(/@e\d+/)?.[0]
    assert(ref)
    const click: Browser.Action = { type: "click", tabID, ref: Browser.Ref.make(ref) }
    const selected = await inspect(click)
    assert.deepEqual(selected.resources, [frameURL])
    await execute({
      type: "evaluate",
      tabID,
      script: `new Promise(resolve => { const frame = document.querySelector('iframe'); frame.onload = () => resolve(null); frame.src = ${JSON.stringify(url + "/frame")}; })`,
    })
    await assert.rejects(execute(click, selected), /target changed|Frame is unavailable|stale/)

    await execute({ type: "evaluate", tabID, script: "document.querySelector('a[href=\"/download\"]').click()" })
    const fileID = await waitForFile()
    const fileAction: Browser.Action = { type: "files.get", tabID, fileID }
    const original = await inspect(fileAction)
    assert(original.resources.includes(url + "/download"))
    await execute({ type: "evaluate", tabID, script: "fetch('/api/test').then(response => response.json())" })
    const requests = Schema.decodeUnknownSync(
      Schema.Struct({ requests: Schema.Array(Schema.Struct({ id: Schema.String, url: Schema.String })) }),
    )((await execute({ type: "network.list", tabID })).value).requests
    const request = requests.find((request) => request.url.includes("/api/test"))
    assert(request)
    assert.deepEqual(await inspect({ type: "network.get", tabID, id: request.id, includeBody: true }), {
      resources: [request.url],
      key: request.id,
    })
    await execute({ type: "navigate", tabID, url: "about:blank" })
    assert.deepEqual(await inspect(fileAction), original)
    assert.equal(Buffer.from((await execute(fileAction, original)).files[0].data).toString(), "desktop download bytes")

    await execute({ type: "navigate", tabID, url })
    await execute({ type: "trace.start", tabID })
    await execute({ type: "navigate", tabID, url: "about:blank" })
    const traceTarget = await inspect({ type: "trace.stop", tabID })
    assert(traceTarget.resources.includes(url + "/"))
    assert(traceTarget.resources.includes("about:blank"))
    const trace = await execute({ type: "trace.stop", tabID }, traceTarget)
    const retained = await inspect({ type: "trace.analyze", tabID, fileID: trace.files[0].id })
    assert(retained.resources.includes(url + "/"))
  } finally {
    await page.dispose()
    assert.equal(win.contentView.children.length, children)
  }

  async function waitForFile() {
    const deadline = Date.now() + 5_000
    while (Date.now() < deadline) {
      const value = (await execute({ type: "files.list", tabID })).value
      const files = Schema.decodeUnknownSync(
        Schema.Struct({ files: Schema.Array(Schema.Struct({ id: Browser.FileID, state: Schema.String })) }),
      )(value).files
      const file = files.find((file) => file.state === "completed")
      if (file) return file.id
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    throw new Error("Download did not complete")
  }
}
