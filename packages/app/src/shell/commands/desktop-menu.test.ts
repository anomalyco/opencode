import { expect, test } from "bun:test"
import terminal, { terminalToggleCommand } from "@opencode/gui-extensions/terminal"
import { settingsOpenCommand } from "@/settings/command"
import { sidebarToggleCommand } from "@/shell/shell"
import { previousSessionCommand, nextSessionCommand } from "@/shell/titlebar/tab-strip"
import { goBackCommand, goForwardCommand, newTabCommand } from "@/shell/titlebar/titlebar"
import { exportLogsCommand } from "./desktop"
import { DESKTOP_MENU } from "./desktop-menu"

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
    // The host publishes extension commands as `${extension}.${id}`.
    `${terminal.id}.${terminalToggleCommand.id}`,
  ])

  const commands = DESKTOP_MENU.flatMap((menu) => menu.items ?? []).flatMap((entry) =>
    entry.type === "item" && entry.command ? [entry.command] : [],
  )

  expect(commands.filter((command) => !registered.has(command))).toEqual([])
})
