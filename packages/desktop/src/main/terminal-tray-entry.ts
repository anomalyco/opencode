import { app } from "electron"
import { runTerminalTray } from "./terminal-tray"

void runTerminalTray().catch(() => {
  console.error("Could not start terminal tray companion")
  app.exit(1)
})
