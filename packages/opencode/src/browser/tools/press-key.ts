import z from "zod"
import { Tool } from "@/tool/tool"
import { BrowserManager } from "@/browser/manager"
import { Log } from "@/util/log"

const log = Log.create({ service: "browser-tools" })

const DESCRIPTION = `Press a key on the keyboard.

Parameters:
- key (string): Name of the key to press or a character. Examples: 'ArrowLeft', 'Enter', 'Escape', 'a', 'A'
- modifiers (array, optional): Modifier keys to hold. Examples: ['Control'], ['Shift'], ['Alt', 'Shift']
`

export const BrowserPressKeyTool = Tool.define("browser_press_key", {
  description: DESCRIPTION,
  parameters: z.object({
    key: z.string().describe("Name of the key to press or a character"),
    modifiers: z.array(z.string()).optional().describe("Modifier keys to hold"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["keyboard"],
      always: ["*"],
      metadata: { action: "press_key", key: params.key, modifiers: params.modifiers },
    })

    if (!BrowserManager.isReady()) {
      await BrowserManager.init({ headed: true })
    }

    log.info("pressing key", { key: params.key, modifiers: params.modifiers })

    try {
      const result = await BrowserManager.pressKey(params.key, params.modifiers)

      if (!result.success) {
        throw new Error(result.error || "Press key failed")
      }

      const keyCombo = params.modifiers?.length ? `${params.modifiers.join("+")}+${params.key}` : params.key

      return {
        title: `Pressed: ${keyCombo}`,
        metadata: {
          key: params.key,
          modifiers: params.modifiers,
        },
        output: `Successfully pressed "${keyCombo}"`,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error("press key failed", { error: message })
      throw new Error(`Press key failed: ${message}`)
    }
  },
})

Tool.attachExecute(BrowserPressKeyTool)
