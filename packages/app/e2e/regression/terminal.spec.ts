import { expect, test, type Page } from "@playwright/test"
import { holdRoute } from "../utils/app"
import { terminalScreen, terminalText } from "../utils/terminal"
import { openSession } from "../utils/workspace"

test.use({ viewport: { width: 1440, height: 900 } })

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"])
})

const SESSION = "ses_terminals"

test("restores a terminal from the server's snapshot after a reload", async ({ page }) => {
  const output = "first-line\r\n"

  const { persistentPty } = await openSession(page, {
    name: "Terminals",
    persistentPty: { initial: [{ id: "pty_restore", sessionID: SESSION, title: "Build", output }] },
  })

  const screen = terminalScreen(page, "pty_restore")

  await openSide(page)
  await side(page).getByRole("tab", { name: "Build", exact: true }).click()
  await expect.poll(() => terminalText(page, screen)).toBe("first-line")
  expect(persistentPty.sockets.map((socket) => socket.cursor)).toEqual([Buffer.byteLength(output)])

  // Output the page never saw: only the server's snapshot can restore it.
  const snapshot = await holdRoute(page, /\/api\/experimental\/persistent-pty\/pty_restore\/snapshot/)
  await page.reload()
  await snapshot.arrived
  persistentPty.output("pty_restore", "while-away\r\n")
  snapshot.release()

  await expect(side(page).getByRole("tab", { name: "Build", exact: true })).toHaveAttribute("aria-selected", "true")
  await expect.poll(() => terminalText(page, screen)).toBe("first-line\nwhile-away")
  expect(persistentPty.sockets.map((socket) => socket.cursor)).toEqual([
    Buffer.byteLength(output),
    Buffer.byteLength(output + "while-away\r\n"),
  ])
})

test("after a reload, the close shortcut closes the restored terminal", async ({ page }) => {
  // Elsewhere Ctrl+W reaches the shell, so the terminal hands only macOS's Cmd+W to the app.
  await page.addInitScript(() => Object.defineProperty(navigator, "platform", { get: () => "MacIntel" }))

  const { persistentPty } = await openSession(page, {
    name: "Terminals",
    persistentPty: {
      initial: [
        { id: "pty_build", sessionID: SESSION, title: "Build" },
        { id: "pty_shell", sessionID: SESSION, title: "Shell" },
      ],
    },
  })

  await openSide(page)
  await showTerminal(page, "Shell", "pty_shell")

  // The restored tab is selected before the server lists the session's terminals.
  const list = await holdRoute(page, /\/api\/experimental\/session\/ses_terminals\/terminal(\?|$)/, { method: "GET" })
  await page.reload()
  await list.arrived
  list.release()

  await expect(side(page).getByRole("tab", { name: "Shell", exact: true })).toHaveAttribute("aria-selected", "true")
  // The terminal connects once it has mounted, and only a mounted terminal takes a click.
  await expect.poll(() => persistentPty.sockets.map((socket) => socket.id)).toEqual(["pty_shell", "pty_shell"])
  await terminalScreen(page, "pty_shell").click()
  await expect(terminalScreen(page, "pty_shell").locator("textarea")).toBeFocused()
  await page.keyboard.press("Meta+W")

  await expect(side(page).getByRole("tab", { name: "Shell", exact: true })).toHaveCount(0)
  await expect(side(page).getByRole("tab", { name: "Build", exact: true })).toBeVisible()
  expect(persistentPty.removed).toEqual(["pty_shell"])
})

test("a terminal another client creates joins the strip without taking it over", async ({ page }) => {
  const { persistentPty } = await openSession(page, { name: "Terminals", persistentPty: {} })

  await openSide(page)
  await expect(side(page).getByRole("tab", { name: "New tab", exact: true })).toHaveAttribute("aria-selected", "true")
  persistentPty.add({ id: "pty_remote", sessionID: SESSION, title: "Remote shell", output: "from-elsewhere\r\n" })

  const tab = side(page).getByRole("tab", { name: "Remote shell", exact: true })
  await expect(tab).toHaveAttribute("aria-selected", "false")
  await expect(side(page).getByRole("tab", { name: "New tab", exact: true })).toHaveAttribute("aria-selected", "true")
  expect(persistentPty.sockets).toHaveLength(0)

  await tab.click()
  await expect.poll(() => terminalText(page, terminalScreen(page, "pty_remote"))).toBe("from-elsewhere")
})

test("a new terminal opens focused, takes control, and streams input and output", async ({ page }) => {
  const { persistentPty } = await openSession(page, { name: "Terminals", persistentPty: {} })

  await openSide(page)
  await side(page)
    .getByRole("button", { name: /^Terminal/ })
    .click()

  await expect(side(page).getByRole("tab", { name: "Terminal 1", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  )
  expect(persistentPty.created.map((info) => ({ title: info.title, cwd: info.cwd }))).toEqual([
    { title: "Terminal 1", cwd: "C:/OpenCode/Terminals" },
  ])
  const id = persistentPty.created[0]!.id
  await expect(terminalScreen(page, id).locator("textarea")).toBeFocused()
  await expect.poll(() => persistentPty.sockets.map((socket) => socket.takeover)).toEqual([true])
  const socket = persistentPty.sockets[0]!
  await expect.poll(() => socket.frames.filter((frame) => frame.type === 0).length).toBeGreaterThan(0)
  expect(persistentPty.controller(id)).toBe(socket.attachmentID)

  await page.keyboard.type("echo hi")
  await expect
    .poll(() =>
      socket.frames
        .filter((frame) => frame.type === 1)
        .map((frame) => frame.data)
        .join(""),
    )
    .toBe("echo hi")

  persistentPty.output(id, "hi\r\n")
  await expect.poll(() => terminalText(page, terminalScreen(page, id))).toBe("hi")
})

test("the New terminal shortcut creates the next numbered terminal", async ({ page }) => {
  const { persistentPty, editor } = await openSession(page, {
    name: "Terminals",
    persistentPty: { initial: [{ id: "pty_first", sessionID: SESSION, title: "Terminal 1" }] },
  })

  await openSide(page)
  await expect(side(page).getByRole("tab", { name: "Terminal 1", exact: true })).toBeVisible()
  await editor.click()
  await page.keyboard.press("Control+Alt+T")

  await expect(side(page).getByRole("tab", { name: "Terminal 2", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  )
  expect(persistentPty.created.map((info) => info.title)).toEqual(["Terminal 2"])
  await expect(terminalScreen(page, persistentPty.created[0]!.id).locator("textarea")).toBeFocused()
})

test("another client's control ends at a click, which resizes the terminal to the pane", async ({ page }) => {
  const { persistentPty } = await openSession(page, {
    name: "Terminals",
    persistentPty: { initial: [{ id: "pty_shared", sessionID: SESSION, title: "Shared" }] },
  })

  await openSide(page)
  await side(page).getByRole("tab", { name: "Shared", exact: true }).click()
  await expect.poll(() => persistentPty.sockets.length).toBe(1)
  const socket = persistentPty.sockets[0]!
  await expect.poll(() => persistentPty.controller("pty_shared")).toBe(socket.attachmentID)

  // The other client controls the terminal at its own size.
  persistentPty.takeControl("pty_shared")
  persistentPty.resize("pty_shared", { cols: 40, rows: 10 })
  const sent = socket.frames.length

  await terminalScreen(page, "pty_shared").click()
  await expect.poll(() => persistentPty.controller("pty_shared")).toBe(socket.attachmentID)
  await expect.poll(() => socket.frames.length).toBeGreaterThan(sent)
  const pane = () => paneSize(socket.frames.at(-1)!)
  expect(socket.frames.slice(sent).map(paneSize)).not.toContainEqual({ cols: 40, rows: 10 })
  await expect.poll(() => persistentPty.terminals[0]!.size).toEqual(pane())

  // While it controls the terminal, the pane's new size follows.
  const before = pane()
  await page.setViewportSize({ width: 1200, height: 600 })
  await expect.poll(() => pane().rows).toBeLessThan(before.rows)
  await expect.poll(() => persistentPty.terminals[0]!.size).toEqual(pane())
})

test("a terminal whose shell exits leaves the strip", async ({ page }) => {
  const { persistentPty } = await openSession(page, {
    name: "Terminals",
    persistentPty: {
      initial: [
        { id: "pty_build", sessionID: SESSION, title: "Build" },
        { id: "pty_shell", sessionID: SESSION, title: "Shell" },
      ],
    },
  })

  await openSide(page)
  await side(page).getByRole("tab", { name: "Build", exact: true }).click()
  await expect.poll(() => persistentPty.sockets.map((socket) => socket.id)).toEqual(["pty_build"])

  persistentPty.exit("pty_build", 0)
  await expect(side(page).getByRole("tab", { name: "Build", exact: true })).toHaveCount(0)
  await expect(side(page).getByRole("tab", { name: "Shell", exact: true })).toBeVisible()
  await expect(page.getByText("Terminal disconnected", { exact: true })).toHaveCount(0)
})

test("a dropped connection says the terminal disconnected and keeps its tab", async ({ page }) => {
  const { persistentPty } = await openSession(page, {
    name: "Terminals",
    persistentPty: { initial: [{ id: "pty_drop", sessionID: SESSION, title: "Build", output: "still-here\r\n" }] },
  })

  await openSide(page)
  await side(page).getByRole("tab", { name: "Build", exact: true }).click()
  const screen = terminalScreen(page, "pty_drop")
  await expect.poll(() => terminalText(page, screen)).toBe("still-here")

  await persistentPty.close("pty_drop")
  await expect(side(page).getByText("Terminal disconnected", { exact: true })).toBeVisible()
  await expect(side(page).getByRole("tab", { name: "Build", exact: true })).toHaveAttribute("aria-selected", "true")
  expect(persistentPty.sockets).toHaveLength(1)
  expect(await terminalText(page, screen)).toBe("still-here")
})

test("after a server restart, showing the terminal again restores it from a new snapshot", async ({ page }) => {
  const output = "before-restart\r\n"

  const { persistentPty } = await openSession(page, {
    name: "Terminals",
    persistentPty: { initial: [{ id: "pty_handoff", sessionID: SESSION, title: "Build", output }] },
  })

  await openSide(page)
  await side(page).getByRole("tab", { name: "Build", exact: true }).click()
  const screen = terminalScreen(page, "pty_handoff")
  await expect.poll(() => terminalText(page, screen)).toBe("before-restart")

  await persistentPty.restart()
  await expect(side(page).getByText("Terminal disconnected", { exact: true })).toBeVisible()
  // The adopted daemon kept the shell running.
  persistentPty.output("pty_handoff", "after-restart\r\n")

  // Showing the tab again takes a new snapshot and reconnects.
  await side(page).getByRole("button", { name: "Add tab", exact: true }).click()
  await expect(side(page).getByRole("tab", { name: "New tab", exact: true })).toHaveAttribute("aria-selected", "true")
  await side(page).getByRole("tab", { name: "Build", exact: true }).click()
  await expect.poll(() => terminalText(page, screen)).toBe("before-restart\nafter-restart")
  await expect(side(page).getByText("Terminal disconnected", { exact: true })).toHaveCount(0)
  expect(persistentPty.sockets.map((socket) => socket.cursor)).toEqual([
    Buffer.byteLength(output),
    Buffer.byteLength(output + "after-restart\r\n"),
  ])
})

test("a server without persistent terminals offers no terminal commands", async ({ page }) => {
  const { editor } = await openSession(page, { name: "Terminals", persistentPty: { capability: false } })

  await openSide(page)
  const launchers = side(page).getByRole("tabpanel", { name: "New tab", exact: true })
  await expect(launchers.getByRole("button", { name: /^Open file/ })).toBeVisible()
  await expect(launchers.getByRole("button", { name: /^Terminal/ })).toHaveCount(0)

  await editor.click()
  await page.keyboard.type("/")
  await expect(page.getByRole("button", { name: /^\/open/ })).toBeVisible()
  await expect(page.getByRole("button", { name: /^\/terminal/ })).toHaveCount(0)
})

test("selected terminal output quotes into the composer", async ({ page }) => {
  await openSession(page, {
    name: "Terminals",
    persistentPty: { initial: [{ id: "pty_quote", sessionID: SESSION, title: "Build", output: "quote-me\r\n" }] },
  })

  await openSide(page)
  await side(page).getByRole("tab", { name: "Build", exact: true }).click()
  const screen = terminalScreen(page, "pty_quote")
  await expect.poll(() => terminalText(page, screen)).toBe("quote-me")

  await page
    .getByRole("toolbar", { name: "Quote selection", exact: true })
    .getByRole("button", { name: "Quote" })
    .click()
  await expect(page.locator('[data-component="composer"]').getByText("quote-me")).toBeVisible()
})

test("renaming a terminal tab renames it on the server", async ({ page }) => {
  const { persistentPty } = await openSession(page, {
    name: "Terminals",
    persistentPty: { initial: [{ id: "pty_named", sessionID: SESSION, title: "Terminal 1" }] },
  })

  await openSide(page)
  const strip = side(page).getByRole("tablist")
  await showTerminal(page, "Terminal 1", "pty_named")
  await strip.getByText("Terminal 1", { exact: true }).dblclick()
  const field = strip.getByRole("textbox", { name: "Rename", exact: true })
  await expect(field).toBeFocused()
  await field.fill("Dev server")
  await field.press("Enter")

  await expect(strip.getByRole("tab", { name: "Dev server", exact: true })).toBeVisible()
  expect(persistentPty.updates).toEqual([{ id: "pty_named", body: { title: "Dev server" } }])
  await expect.poll(() => persistentPty.terminals[0]!.title).toBe("Dev server")
})

test("a rename from another client relabels the tab", async ({ page }) => {
  const { persistentPty } = await openSession(page, {
    name: "Terminals",
    persistentPty: { initial: [{ id: "pty_named", sessionID: SESSION, title: "Terminal 1" }] },
  })

  await openSide(page)
  await expect(side(page).getByRole("tab", { name: "Terminal 1", exact: true })).toBeVisible()
  persistentPty.rename("pty_named", "Logs")
  await expect(side(page).getByRole("tab", { name: "Logs", exact: true })).toBeVisible()
  await expect(side(page).getByRole("tab", { name: "Terminal 1", exact: true })).toHaveCount(0)
})

test("clearing a terminal's name resets a renamed one and leaves a never-renamed one alone", async ({ page }) => {
  const { persistentPty } = await openSession(page, {
    name: "Terminals",
    persistentPty: {
      initial: [
        { id: "pty_plain", sessionID: SESSION, title: "Terminal 1" },
        { id: "pty_renamed", sessionID: SESSION, title: "Terminal 2", userTitle: "Deploy" },
      ],
    },
  })

  await openSide(page)
  const strip = side(page).getByRole("tablist")
  const field = strip.getByRole("textbox", { name: "Rename", exact: true })

  await showTerminal(page, "Terminal 1", "pty_plain")
  await strip.getByText("Terminal 1", { exact: true }).dblclick()
  await expect(field).toBeFocused()
  await field.fill("")
  await field.press("Enter")
  await expect(field).toHaveCount(0)
  await expect(strip.getByRole("tab", { name: "Terminal 1", exact: true })).toBeVisible()

  await showTerminal(page, "Deploy", "pty_renamed")
  await strip.getByText("Deploy", { exact: true }).dblclick()
  await expect(field).toBeFocused()
  await field.fill("")
  await field.press("Enter")

  await expect(strip.getByRole("tab", { name: "Terminal 2", exact: true })).toBeVisible()
  await expect(strip.getByRole("tab", { name: "Deploy", exact: true })).toHaveCount(0)
  // The first clear sent nothing: the only update is the second.
  expect(persistentPty.updates).toEqual([{ id: "pty_renamed", body: { title: null } }])
})

test("a server whose terminal service cannot rename yet keeps the old name and says when it will", async ({ page }) => {
  const { persistentPty } = await openSession(page, {
    name: "Terminals",
    persistentPty: {
      renameSupported: false,
      initial: [{ id: "pty_named", sessionID: SESSION, title: "Terminal 1" }],
    },
  })

  await openSide(page)
  const strip = side(page).getByRole("tablist")
  await showTerminal(page, "Terminal 1", "pty_named")
  await strip.getByText("Terminal 1", { exact: true }).dblclick()
  const field = strip.getByRole("textbox", { name: "Rename", exact: true })
  await expect(field).toBeFocused()
  await field.fill("Dev server")
  await field.press("Enter")

  await expect(
    page.getByText("Terminal renaming will be available after OpenCode's terminal service restarts", { exact: true }),
  ).toBeVisible()
  await expect(strip.getByRole("tab", { name: "Terminal 1", exact: true })).toBeVisible()
  await expect(strip.getByRole("tab", { name: "Dev server", exact: true })).toHaveCount(0)
  expect(persistentPty.terminals[0]!.title).toBe("Terminal 1")
})

test.describe("narrow screens", () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test("the Terminal view opens from More... and shows the session's terminal", async ({ page }) => {
    const { persistentPty } = await openSession(page, {
      name: "Terminals",
      persistentPty: { initial: [{ id: "pty_mobile", sessionID: SESSION, title: "Build", output: "on-mobile\r\n" }] },
    })

    const tabs = page.getByRole("tablist", { name: "Session view", exact: true })
    const views = page.getByRole("dialog", { name: "More options", exact: true })
    await tabs.getByRole("tab", { name: "More...", exact: true }).click()
    await views.getByRole("button", { name: "Terminal", exact: true }).click()
    await expect(views).toBeHidden()

    const panel = page.locator("#terminal-panel")
    await expect(panel.getByRole("tab", { name: "Build", exact: true })).toHaveAttribute("aria-selected", "true")
    await expect.poll(() => terminalText(page, terminalScreen(page, "pty_mobile"))).toBe("on-mobile")
    expect(persistentPty.created).toEqual([])
  })

  test("an empty session's Terminal view starts its first terminal", async ({ page }) => {
    const { persistentPty } = await openSession(page, { name: "Terminals", persistentPty: {} })

    await page.getByRole("tablist", { name: "Session view", exact: true }).getByRole("tab", { name: "More..." }).click()
    await page
      .getByRole("dialog", { name: "More options", exact: true })
      .getByRole("button", { name: "Terminal" })
      .click()

    const panel = page.locator("#terminal-panel")
    await expect(panel.getByRole("tab", { name: "Terminal 1", exact: true })).toHaveAttribute("aria-selected", "true")
    expect(persistentPty.created.map((info) => info.title)).toEqual(["Terminal 1"])
    await expect(terminalScreen(page, persistentPty.created[0]!.id).locator("textarea")).toBeEditable()
    await expect.poll(() => persistentPty.sockets.map((socket) => socket.id)).toEqual([persistentPty.created[0]!.id])
  })

  test("double-clicking a terminal tab that is not selected yet starts renaming it", async ({ page }) => {
    const { persistentPty } = await openSession(page, {
      name: "Terminals",
      persistentPty: {
        initial: [
          { id: "pty_first", sessionID: SESSION, title: "Build" },
          { id: "pty_second", sessionID: SESSION, title: "Deploy" },
        ],
      },
    })

    await page.getByRole("tablist", { name: "Session view", exact: true }).getByRole("tab", { name: "More..." }).click()
    await page
      .getByRole("dialog", { name: "More options", exact: true })
      .getByRole("button", { name: "Terminal" })
      .click()

    const panel = page.locator("#terminal-panel")
    await expect.poll(() => persistentPty.sockets.map((socket) => socket.id)).toEqual(["pty_first"])
    const field = panel.getByRole("textbox", { name: "Rename", exact: true })
    await panel.getByText("Deploy", { exact: true }).dblclick()
    await expect(field).toBeFocused()
    // The terminal connects after it mounts and asks for focus.
    await expect.poll(() => persistentPty.sockets.map((socket) => socket.id)).toEqual(["pty_first", "pty_second"])
    await expect(field).toBeFocused()
  })

  test("Escape cancels a terminal rename and Enter renames once", async ({ page }) => {
    const { persistentPty } = await openSession(page, {
      name: "Terminals",
      persistentPty: { initial: [{ id: "pty_mobile", sessionID: SESSION, title: "Build" }] },
    })

    await page.getByRole("tablist", { name: "Session view", exact: true }).getByRole("tab", { name: "More..." }).click()
    await page
      .getByRole("dialog", { name: "More options", exact: true })
      .getByRole("button", { name: "Terminal" })
      .click()

    const panel = page.locator("#terminal-panel")
    const field = panel.getByRole("textbox", { name: "Rename", exact: true })
    await expect.poll(() => persistentPty.sockets.map((socket) => socket.id)).toEqual(["pty_mobile"])

    await panel.getByText("Build", { exact: true }).dblclick()
    await expect(field).toBeFocused()
    await field.fill("Cancelled")
    await field.press("Escape")
    await expect(field).toHaveCount(0)
    await expect(panel.getByRole("tab", { name: "Build", exact: true })).toBeVisible()

    await panel.getByText("Build", { exact: true }).dblclick()
    await expect(field).toBeFocused()
    await field.fill("Deploy")
    await field.press("Enter")
    await expect(panel.getByRole("tab", { name: "Deploy", exact: true })).toBeVisible()
    expect(persistentPty.updates).toEqual([{ id: "pty_mobile", body: { title: "Deploy" } }])
  })
})

// Selecting the tab mounts its terminal, which asks for focus; the rename field keeps it.
test("double-clicking a terminal tab that is not selected yet starts renaming it", async ({ page }) => {
  const { persistentPty } = await openSession(page, {
    name: "Terminals",
    persistentPty: { initial: [{ id: "pty_named", sessionID: SESSION, title: "Terminal 1" }] },
  })

  // The terminal mounts once ghostty-web loads, which here waits until the rename field has focus.
  const ghostty = await holdRoute(page, /\/_assets\/ghostty-web-[^/]+\.js$/)
  await openSide(page)
  const strip = side(page).getByRole("tablist")
  const field = strip.getByRole("textbox", { name: "Rename", exact: true })
  await strip.getByText("Terminal 1", { exact: true }).dblclick()
  await expect(field).toBeFocused()
  ghostty.release()
  // The terminal connects after it mounts and asks for focus.
  await expect.poll(() => persistentPty.sockets.map((socket) => socket.id)).toEqual(["pty_named"])
  await expect(field).toBeFocused()
})

// The menu returns focus to the tab as it closes; choosing Rename moves it to the rename field.
test("a terminal tab's context menu starts renaming it", async ({ page }) => {
  await openSession(page, {
    name: "Terminals",
    persistentPty: { initial: [{ id: "pty_named", sessionID: SESSION, title: "Terminal 1" }] },
  })

  await openSide(page)
  const strip = side(page).getByRole("tablist")
  await showTerminal(page, "Terminal 1", "pty_named")
  await strip.getByText("Terminal 1", { exact: true }).click({ button: "right" })
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click()
  await expect(strip.getByRole("textbox", { name: "Rename", exact: true })).toBeFocused()
})

function side(page: Page) {
  return page.getByRole("complementary", { name: "Review and files", exact: true })
}

async function openSide(page: Page) {
  await page.getByRole("button", { name: "Toggle review", exact: true }).click()
  await expect(side(page)).toBeVisible()
}

async function showTerminal(page: Page, title: string, ptyID: string) {
  await side(page).getByRole("tab", { name: title, exact: true }).click()
  await expect(terminalScreen(page, ptyID).locator("textarea")).toBeFocused()
}

function paneSize(frame: { cols: number; rows: number }) {
  return { cols: frame.cols, rows: frame.rows }
}
