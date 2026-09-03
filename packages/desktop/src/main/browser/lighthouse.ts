import type { WebContents } from "electron"
import type { Page } from "puppeteer-core"
import { EventEmitter } from "node:events"
import type { BrowserFiles } from "./files"
import type { Cdp } from "./cdp"

export async function audit(contents: WebContents, files: BrowserFiles, cdp: Cdp) {
  const { snapshot, generateReport } = await import("lighthouse")
  const info = (await contents.debugger.sendCommand("Target.getTargetInfo")) as { targetInfo: { targetId: string } }
  const sessions = new Map<string, ReturnType<typeof session>>()
  function session(id: string) {
    const emitter = new EventEmitter()
    const value = Object.assign(emitter, {
      id: () => id,
      send: (method: string, params?: object) => cdp.send(method as Parameters<Cdp["send"]>[0], params, id),
      detach: async () => {
        sessions.delete(id)
        await contents.debugger.sendCommand("Target.detachFromTarget", { sessionId: id })
      },
    })
    sessions.set(id, value)
    return value
  }
  const event = (_event: Electron.Event, method: string, params: unknown, sessionID?: string) => {
    const owner = sessionID ? sessions.get(sessionID) : undefined
    if (!owner) return
    if (method === "Target.attachedToTarget") {
      const child = params as { sessionId: string }
      owner.emit("sessionattached", session(child.sessionId))
    }
    owner.emit(method, params)
    owner.emit("*", method, params)
  }
  contents.debugger.on("message", event)
  try {
    const attached = (await contents.debugger.sendCommand("Target.attachToTarget", {
      targetId: info.targetInfo.targetId,
      flatten: true,
    })) as { sessionId: string }
    const root = session(attached.sessionId)
    // Lighthouse's snapshot driver uses only url() and target().createCDPSession().
    // Adapt that narrow boundary to Electron instead of exposing a browser-wide
    // Puppeteer connection or emulating unsupported Browser/Target commands.
    const page = {
      url: () => contents.getURL(),
      target: () => ({ createCDPSession: async () => root }),
    } as unknown as Page
    // Our screenshot tool handles captures separately. Lighthouse's screenshot
    // gatherer resizes the viewport and waits for frames that hidden views may not paint.
    const result = await snapshot(page, {
      flags: {
        onlyCategories: ["accessibility", "seo", "best-practices"],
        formFactor: "desktop",
        screenEmulation: { disabled: true },
        throttlingMethod: "provided",
        disableStorageReset: true,
        disableFullPageScreenshot: true,
      },
    })
    if (!result)
      throw new Error(
        "Lighthouse did not produce a report. Check browser.console and browser.network.list for page failures and confirm the tab has loaded. Report an audit failure if the page is healthy; do not repeat the audit unchanged.",
      )
    return {
      scores: Object.values(result.lhr.categories).map((category) => ({
        id: category.id,
        title: category.title,
        score: category.score,
      })),
      failures: Object.values(result.lhr.audits)
        .filter((audit) => audit.score !== null && audit.score < 1)
        .map((audit) => ({ id: audit.id, title: audit.title, description: audit.description }))
        .slice(0, 100),
      files: await Promise.all([
        files.save("lighthouse.json", "application/json", Buffer.from(generateReport(result.lhr, "json"))),
        files.save("lighthouse.html", "text/html", Buffer.from(generateReport(result.lhr, "html"))),
      ]),
    }
  } finally {
    contents.debugger.off("message", event)
    await Promise.all(Array.from(sessions.values(), (session) => session.detach().catch(() => undefined)))
  }
}
