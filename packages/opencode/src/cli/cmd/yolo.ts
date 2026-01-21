import path from "path"
import { cmd } from "./cmd"
import { Global } from "../../global"
import { UI } from "../ui"

async function readGlobalConfig(): Promise<Record<string, unknown>> {
  const filepath = path.join(Global.Path.config, "config.json")
  try {
    const text = await Bun.file(filepath).text()
    return JSON.parse(text)
  } catch {
    return {}
  }
}

async function writeGlobalConfig(config: Record<string, unknown>): Promise<void> {
  const filepath = path.join(Global.Path.config, "config.json")
  await Bun.write(filepath, JSON.stringify(config, null, 2))
}

const YoloStatusCommand = cmd({
  command: "status",
  describe: "Show YOLO mode status",
  handler: async () => {
    const config = await readGlobalConfig()
    const enabled = config.yolo === true

    if (enabled) {
      UI.println(`YOLO mode: ${UI.Style.TEXT_DANGER_BOLD}ENABLED${UI.Style.TEXT_NORMAL} (saved in config)`)
      UI.println(`Config: ${path.join(Global.Path.config, "config.json")}`)
    } else {
      UI.println(`YOLO mode: ${UI.Style.TEXT_DIM}disabled${UI.Style.TEXT_NORMAL}`)
    }
    UI.println("")
    UI.println("Use 'opencode yolo enable' to enable permanently")
    UI.println("Use 'opencode yolo disable' to disable")
    UI.println("Use 'opencode --yolo' for one session only")
  },
})

const YoloEnableCommand = cmd({
  command: "enable",
  describe: "Enable YOLO mode permanently (saves to config)",
  handler: async () => {
    const config = await readGlobalConfig()
    config.yolo = true
    await writeGlobalConfig(config)
    UI.println(`${UI.Style.TEXT_DANGER_BOLD}YOLO mode ENABLED${UI.Style.TEXT_NORMAL} - saved to config`)
    UI.println(`Config: ${path.join(Global.Path.config, "config.json")}`)
    UI.println("")
    UI.println(`${UI.Style.TEXT_WARNING}Warning: All permission prompts will be skipped!${UI.Style.TEXT_NORMAL}`)
  },
})

const YoloDisableCommand = cmd({
  command: "disable",
  describe: "Disable YOLO mode (removes from config)",
  handler: async () => {
    const config = await readGlobalConfig()
    delete config.yolo
    await writeGlobalConfig(config)
    UI.println(`YOLO mode ${UI.Style.TEXT_SUCCESS}disabled${UI.Style.TEXT_NORMAL} - removed from config`)
  },
})

export const YoloCommand = cmd({
  command: "yolo",
  describe: "Manage YOLO mode (skip permission prompts)",
  builder: (yargs) =>
    yargs.command(YoloStatusCommand).command(YoloEnableCommand).command(YoloDisableCommand).demandCommand(),
  handler: () => {},
})
