import { expect, test } from "bun:test"
import { terminalToggleCommand } from "@opencode/gui-plugins/terminal"
import { settingsOpenCommand } from "@/settings/command"
import { sidebarToggleCommand } from "@/shell/shell"
import { previousSessionCommand, nextSessionCommand } from "@/shell/titlebar/tab-strip"
import { goBackCommand, goForwardCommand, newTabCommand } from "@/shell/titlebar/titlebar"
import { exportLogsCommand } from "./desktop"
import { DESKTOP_MENU, nextDesktopZoomLevel } from "./desktop-menu"

test("every desktop menu command is one its owner registers", () => {
  const registered = new Set([
    settingsOpenCommand.id,
    exportLogsCommand.id,
    newTabCommand.id,
    sidebarToggleCommand.id,
    goBackCommand.id,
    goForwardCommand.id,
    previousSessionCommand.id,
    nextSessionCommand.id,
    // The host publishes plugin commands as `${plugin}.${id}`; the built-in list names the terminal `terminal`.
    `terminal.${terminalToggleCommand.id}`,
  ])

  const commands = DESKTOP_MENU.flatMap((menu) => menu.items ?? []).flatMap((entry) =>
    entry.type === "item" && entry.command ? [entry.command] : [],
  )

  expect(commands.filter((command) => !registered.has(command))).toEqual([])
})

test.each([
  { factor: 1, direction: "in", level: 1.1 },
  { factor: 1.25, direction: "out", level: 1.1 },
  // A factor read back from Chromium sits a hair off the level it was set to.
  { factor: 1.0999999, direction: "in", level: 1.25 },
  { factor: 1.1000001, direction: "out", level: 1 },
  // A pinch leaves the factor between levels, or outside them.
  { factor: 1.3, direction: "in", level: 1.5 },
  { factor: 1.3, direction: "out", level: 1.25 },
  { factor: 0.5, direction: "out", level: 1 },
  { factor: 3, direction: "in", level: 2 },
  { factor: 2, direction: "in", level: 2 },
  { factor: 1, direction: "out", level: 1 },
] as const)("zooming $direction from $factor lands on $level", ({ factor, direction, level }) => {
  expect(nextDesktopZoomLevel(factor, direction)).toBe(level)
})
