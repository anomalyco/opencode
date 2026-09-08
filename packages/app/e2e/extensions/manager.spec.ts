import { expect, test } from "@playwright/test"
import { Schema } from "effect"
import { createServer } from "node:http"
import { once } from "node:events"
import { openDatabase } from "../../../desktop/src/main/storage/database"
import { createExtensionManager, readExtensionAsset } from "../../../desktop/src/main/extensions/manager"
import { ExtensionManager } from "@opencode/plugin/desktop/manager"
import { extensionArchive } from "../../../desktop/test/extensions/fixture"
import { mockOpenCodeServer } from "../utils/mock-server"
import { fixture } from "../performance/timeline/session-timeline-stress.fixture"
import { installStressSessionTabs } from "../performance/timeline/timeline-test-helpers"

const renderer = (version: string) => `
  const { usePlugin } = require('@opencode/plugin/desktop');
  const { createEffect, createComponent } = require('solid-js');
  const { Panel } = require('@opencode/plugin/desktop/solid');
  module.exports.default = { id: 'test.lifecycle', setup(ctx) {
    const [state, update] = ctx.storage.memory('counts', { initial: { starts: 0, stops: 0 } });
    update(state => state.starts++);
    ctx.lifecycle.own(() => update(state => state.stops++));
    const marker = (id) => {
      const output = document.createElement('output'); output.hidden = true; output.dataset.testid = id;
      createEffect(() => output.textContent = ${JSON.stringify(version)} + ':' + state.starts + ':' + state.stops);
      return output;
    };
    ctx.commands.register(() => [{ id: 'show', title: 'Show extension fixture', bind: 'mod+shift+y', run() { const session = ctx.sessions.current(); if (session) ctx.ui.panel.open('state', session) } }]);
    ctx.ui.slot({ append: 'session.panel', render: () => createComponent(Panel, { id: 'state', title: 'File utilities', group: 'state', get children() { return marker('extension-panel-lifecycle') } }) });
    ctx.ui.slot({ append: 'app', render() {
      if (usePlugin().lifecycle.signal !== ctx.lifecycle.signal) throw new Error('Shared plugin context identity was lost');
      return marker('extension-lifecycle');
    } });
  } };`
const payload = Schema.Struct({
  id: Schema.optionalKey(Schema.String),
  revision: Schema.optionalKey(Schema.String),
  enabled: Schema.optionalKey(Schema.Boolean),
  url: Schema.optionalKey(Schema.String),
})

for (const direction of ["ltr", "rtl"] as const)
  test(`manager installs, hot-replaces, reloads, and disables across windows in ${direction}`, async ({
    page,
    context,
  }, info) => {
    const database = openDatabase(":memory:")
    const manager = createExtensionManager({
      db: database.db,
      fetch,
      changed(_id, entries) {
        context.pages().forEach((page) => {
          void page.evaluate(
            (entries) => window.dispatchEvent(new CustomEvent("test-extensions-changed", { detail: entries })),
            entries,
          )
        })
      },
    })
    const archive = async (version: string, code = renderer(version)) =>
      extensionArchive({
        version,
        renderer: code,
        files: { "assets/style.css": ":root { --installed-extension-marker: 1; }" },
        manifest: {
          imports: ["@opencode/plugin/desktop", "@opencode/plugin/desktop/solid", "solid-js"],
          style: "assets/style.css",
        },
      })
    const first = await archive("1.0.0")
    const http = createServer((_request, response) => {
      response.setHeader("Content-Type", "application/vnd.ocdx")
      response.end(first)
    })
    http.listen(0, "127.0.0.1")
    await once(http, "listening")
    const address = http.address()
    if (!address || typeof address === "string") throw new Error("Fixture address is unavailable")
    await context.route("**/__desktop-extensions/**", async (route) => {
      const path = new URL(route.request().url()).pathname.split("/").slice(2)
      try {
        if (path[0] === "assets") {
          const bytes = readExtensionAsset(database.db, path[1], path[2], path.slice(3).join("/"))
          await route.fulfill({ status: bytes ? 200 : 404, body: bytes, contentType: "text/css" })
          return
        }
        const data = Schema.decodeUnknownSync(payload)(
          JSON.parse(path[0] === "install" ? "{}" : (route.request().postData() ?? "{}")),
        )
        const result =
          path[0] === "install"
            ? await manager.install(route.request().postDataBuffer()!)
            : path[0] === "url"
              ? await manager.installURL(data.url ?? "")
              : path[0] === "enable"
                ? manager.enable(data.id ?? "", data.enabled ?? false)
                : path[0] === "reload"
                  ? manager.reload(data.id ?? "")
                  : path[0] === "source"
                    ? manager.source(data.id ?? "", data.revision)
                    : manager.list()
        await route.fulfill({ json: result })
      } catch (error) {
        await route.fulfill({
          status: 400,
          json: { code: error instanceof ExtensionManager.ManagerError ? error.code : "storage" },
        })
      }
    })
    const open = async (target: typeof page) => {
      await mockOpenCodeServer(target, {
        sessions: fixture.sessions,
        provider: fixture.provider,
        directory: fixture.directory,
        project: fixture.project,
        pageMessages: () => ({ items: [] }),
      })
      await installStressSessionTabs(target)
      await target.goto("/e2e/extensions/manager-fixture.html")
      await target.getByTestId("settings-screen").getByRole("tab", { name: "Extensions", exact: true }).click()
      await expect(target.getByRole("heading", { name: "Install extensions", exact: true })).toBeVisible()
      const settings = target.getByTestId("settings-screen")
      const navigation = settings.locator(".settings-nav")
      await expect(
        navigation
          .locator('[data-slot="settings-nav-group"]')
          .filter({ has: target.getByRole("tab", { name: "Extensions", exact: true }) })
          .getByRole("tab"),
      ).toHaveText(["Extensions", "Experimental"])
      await expect(
        navigation
          .locator('[data-slot="settings-nav-group"]')
          .filter({ has: target.getByRole("tab", { name: "Tools", exact: true }) })
          .getByRole("tab"),
      ).toHaveText(["Providers", "Models", "Tools"])
      await expect(settings.getByRole("tab", { name: "Desktop", exact: true })).toHaveCount(0)
      await expect(settings.getByRole("tab", { name: "MCPs", exact: true })).toHaveCount(0)
      await settings.getByRole("tab", { name: "Tools", exact: true }).click()
      await expect(settings.getByRole("heading", { name: "Tools", exact: true })).toBeVisible()
      await expect(settings.getByRole("tab", { name: "MCPs", exact: true })).toBeVisible()
      await expect(settings.getByRole("tab", { name: "Plugins", exact: true })).toBeVisible()
      await expect(settings.getByRole("tab", { name: "Skills", exact: true })).toBeVisible()
      await expect(settings.getByRole("heading", { name: "Install extensions", exact: true })).toHaveCount(0)
      await settings.getByRole("tab", { name: "Extensions", exact: true }).click()
      await target.evaluate((direction) => {
        document.documentElement.dir = direction
      }, direction)
    }
    try {
      await open(page)
      await page.setViewportSize({ width: 640, height: 900 })
      await page.getByRole("button", { name: "Extensions", exact: true }).click()
      await page.getByRole("menuitemradio", { name: "Tools", exact: true }).click()
      await expect(page.getByRole("heading", { name: "Tools", exact: true })).toBeVisible()
      await page.getByRole("button", { name: "Tools", exact: true }).click()
      await page.getByRole("menuitemradio", { name: "Extensions", exact: true }).click()
      await expect(page.getByRole("heading", { name: "Install extensions", exact: true })).toBeVisible()
      await page.setViewportSize({ width: 1280, height: 720 })
      await expect(page.locator('[data-component="desktop-extension-manager"]').getByRole("status")).toHaveCount(0)
      await page.screenshot({ path: info.outputPath("extensions-manager-empty.png") })
      await page
        .getByRole("textbox", { name: "Extension URL", exact: true })
        .fill(`http://127.0.0.1:${address.port}/extension.ocdx`)
      await page.getByRole("textbox", { name: "Extension URL", exact: true }).press("Enter")
      const enabled = page.getByRole("switch", { name: "Enable File utilities", exact: true })
      await expect(enabled).toBeChecked()
      await expect(page.getByTestId("extension-lifecycle")).toHaveText("1.0.0:1:0")
      await page.screenshot({ path: info.outputPath("extensions-manager.png") })
      await page.getByRole("button", { name: "Reload File utilities", exact: true }).click()
      await expect(page.getByTestId("extension-lifecycle")).toHaveText("1.0.0:2:1")
      await expect(page.locator('link[href*="/__desktop-extensions/assets/"]')).toHaveCount(1)
      const second = await context.newPage()
      await open(second)
      await expect(second.getByTestId("extension-lifecycle")).toHaveText("1.0.0:1:0")
      await second.locator('header a[href$="/ses_smoke_source"]').click()
      await expect(second.getByRole("heading", { name: fixture.expected.sourceTitle, exact: true })).toBeVisible()
      await expect(second.getByRole("button", { name: "Toggle review", exact: true })).toBeEnabled()
      await second.keyboard.press("Control+Shift+y")
      await expect(second.getByTestId("extension-panel-lifecycle")).toHaveText("1.0.0:1:0")
      await page.getByLabel("Extension files", { exact: true }).setInputFiles({
        name: "update.ocdx",
        mimeType: "application/vnd.ocdx",
        buffer: Buffer.from(await archive("2.0.0")),
      })
      await expect(page.getByTestId("extension-lifecycle")).toHaveText("2.0.0:3:2")
      await expect(second.getByTestId("extension-lifecycle")).toHaveText("2.0.0:2:1")
      await expect(second.getByTestId("extension-panel-lifecycle")).toHaveText("2.0.0:2:1")
      await page.getByLabel("Extension files", { exact: true }).setInputFiles({
        name: "broken.ocdx",
        mimeType: "application/vnd.ocdx",
        buffer: Buffer.from(
          await archive(
            "3.0.0",
            `module.exports.default = { id: 'test.lifecycle', setup(ctx) { ctx.ui.slot({ append: 'app', render() { const node = document.createElement('output'); node.hidden = true; node.dataset.testid = 'partial-load'; return node } }); throw new Error('broken update') } }`,
          ),
        ),
      })
      await expect(page.getByRole("alert")).toHaveText("Unable to activate File utilities.")
      await expect(page.getByTestId("extension-lifecycle")).toHaveText("2.0.0:3:2")
      await expect(page.getByTestId("partial-load")).toHaveCount(0)
      await expect(page.locator('link[href*="/__desktop-extensions/assets/"]')).toHaveCount(1)
      await page.getByLabel("Extension files", { exact: true }).setInputFiles({
        name: "fixed.ocdx",
        mimeType: "application/vnd.ocdx",
        buffer: Buffer.from(await archive("4.0.0")),
      })
      await expect(page.getByTestId("extension-lifecycle")).toHaveText("4.0.0:4:3")
      await second.keyboard.press("Control+,")
      await second.getByTestId("settings-screen").getByRole("tab", { name: "Extensions", exact: true }).click()
      await page
        .locator('[data-component="settings-row"]')
        .filter({ has: enabled })
        .locator('[data-slot="switch-control"]')
        .click()
      await expect(second.getByRole("switch", { name: "Enable File utilities", exact: true })).not.toBeChecked()
      await expect(page.getByTestId("extension-lifecycle")).toHaveCount(0)
      await expect(second.getByTestId("extension-lifecycle")).toHaveCount(0)
      await expect(page.locator('link[href*="/__desktop-extensions/assets/"]')).toHaveCount(0)
      await enabled.press("Space")
      await expect(page.getByTestId("extension-lifecycle")).toHaveText("4.0.0:5:4")
      await expect(second.getByTestId("extension-lifecycle")).toHaveText("4.0.0:4:3")
      const archives = await Promise.all(
        ["Text helpers", "Path helpers"].map(async (name, index) => ({
          name: `helper-${index}.ocdx`,
          bytes: Buffer.from(await extensionArchive({ id: `test.helper-${index}`, manifest: { name } })).toString(
            "base64",
          ),
        })),
      )
      const drop = await page.evaluateHandle((archives) => {
        const transfer = new DataTransfer()
        archives.forEach((archive) =>
          transfer.items.add(
            new File([Uint8Array.from(atob(archive.bytes), (char) => char.charCodeAt(0))], archive.name),
          ),
        )
        return transfer
      }, archives)
      await page.locator(".desktop-extension-drop").dispatchEvent("drop", { dataTransfer: drop })
      await expect(page.getByRole("switch", { name: "Enable Text helpers", exact: true })).toBeChecked()
      await expect(second.getByRole("switch", { name: "Enable Path helpers", exact: true })).toBeChecked()
      await drop.dispose()
      await second.close()
    } finally {
      http.close()
      database.close()
    }
  })
