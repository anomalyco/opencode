import { base64Encode, checksum } from "@opencode/util/encode"
import { expect, test } from "@playwright/test"
import { sessionHref } from "../utils/app"
import { mockWorkspace, openSession, type WorkspaceInput } from "../utils/workspace"
import { expectSessionTitle } from "../utils/waits"

const workspace = { name: "TerminalInput", pty: {} } satisfies WorkspaceInput

test.use({ viewport: { width: 1440, height: 900 } })

test("clears the terminal line with Command+Delete", async ({ page }) => {
  const { pty } = await openSession(page, workspace)
  const terminal = page.locator('[data-component="terminal"]')
  await page.keyboard.press("Control+Backquote")
  await expect(terminal.locator("textarea")).toHaveCount(1)
  await expect.poll(() => pty.sockets.length).toBe(1)

  await page.keyboard.press("Meta+Backspace")
  await expect.poll(() => pty.sockets[0]!.input.join("")).toBe("\x15")
})

test("reveals the terminal after its first output and hides the native caret", async ({ page }) => {
  const { pty } = await openSession(page, workspace)
  await page.keyboard.press("Control+Backquote")
  const terminal = page.locator('[data-component="terminal"]')
  await expect(terminal).toHaveAttribute("contenteditable", "true")
  await expect(terminal).toHaveCSS("caret-color", "rgba(0, 0, 0, 0)")
  await expect(terminal).toHaveCSS("opacity", "0")
  await expect.poll(() => pty.sockets.length).toBe(1)

  pty.send("\x1b[?25h")
  await expect(terminal).toHaveCSS("opacity", "0")
  pty.send("ready")
  await expect(terminal).toHaveCSS("opacity", "1")
})

test("routes typing to the composer unless the open terminal is focused", async ({ page }) => {
  const { pty, editor } = await openSession(page, workspace)
  const terminal = page.locator('[data-component="terminal"]')
  await editor.click()
  await expect(editor).toBeFocused()
  await page.keyboard.press("Control+Backquote")
  await expect(terminal).toBeVisible()
  await expect.poll(() => terminal.evaluate((element) => element.contains(document.activeElement))).toBe(true)

  await page.keyboard.type("x")
  await expect(editor).toHaveText("")
  await expect.poll(() => pty.sockets.length).toBe(1)
  pty.send("ready")
  await expect(terminal).toHaveCSS("opacity", "1")
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.type("a")
  await expect(editor).toBeFocused()
  await expect(editor).toHaveText("a")
})

for (const mount of ["cached", "explicit"] as const) {
  test(`keeps newer composer focus while a ${mount} terminal finishes mounting`, async ({ page }) => {
    const ghostty = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    await page.route(/ghostty-web/, async (route) => {
      ghostty.resolve()
      await release.promise
      await route.continue()
    })
    const cached = { id: "pty_cached", title: "Terminal 1" }
    const { pty, sessions } = await mockWorkspace(page, {
      ...workspace,
      pty: mount === "cached" ? { initial: [cached] } : {},
      seed:
        mount === "cached"
          ? {
              panes: { ses_terminalinput: { terminal: true, terminalHeight: 320 } },
              // The pre-extension terminal store, which the terminal extension imports.
              storage: { [legacyTerminalKey()]: { active: cached.id, all: [{ ...cached, titleNumber: 1 }] } },
            }
          : undefined,
    })
    await page.goto(sessionHref(sessions[0]!.id), { waitUntil: "commit" })
    await expectSessionTitle(page, "TerminalInput")
    const editor = page.locator('[data-component="composer-editor"]')
    const terminal = page.locator('[data-component="terminal"]')
    if (mount === "explicit") {
      await expect(editor).toBeEditable()
      await page.keyboard.press("Control+Backquote")
    }
    await expect(terminal).toBeVisible()
    await ghostty.promise
    await editor.click()
    await expect(editor).toBeFocused()

    release.resolve()
    await expect(terminal.locator("textarea")).toHaveCount(1)
    await expect.poll(() => pty.sockets.length).toBe(1)
    pty.send("ready")
    await expect(terminal).toHaveCSS("opacity", "1")
    await expect(editor).toBeFocused()
    if (mount === "cached") expect(pty.created).toEqual([])
  })
}

test("focuses a terminal created from the new-terminal button", async ({ page }) => {
  const { editor } = await openSession(page, workspace)
  const terminal = page.locator('[data-component="terminal"]')
  await page.keyboard.press("Control+Backquote")
  await expect(terminal.locator("textarea")).toHaveCount(1)
  await editor.click()
  await expect(editor).toBeFocused()

  await page.getByRole("button", { name: "New terminal" }).click()
  await expect(page.getByRole("tab", { name: "Terminal 2" })).toHaveAttribute("aria-selected", "true")
  const active = page.locator('#terminal-wrapper-pty_2 [data-component="terminal"]')
  await expect.poll(() => active.evaluate((element) => element.contains(document.activeElement))).toBe(true)
})

function legacyTerminalKey() {
  const dir = base64Encode("C:/OpenCode/TerminalInput")
  const head = dir.slice(0, 12).replace(/[^a-zA-Z0-9._-]/g, "-")
  return `opencode.workspace.${head}.${checksum(dir) ?? "0"}.dat:workspace:terminal`
}
