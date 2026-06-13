import { ipcMain, BrowserWindow } from "electron"
import type { IpcMainInvokeEvent } from "electron"
import { click, drag, scroll } from "./mouse"
import { typeText, pressKey, type KeyPressOptions } from "./keyboard"

type ModifierKey = NonNullable<KeyPressOptions["modifiers"]>[number]
import { getActiveWebview } from "../browser-automation"

export interface ComputerUseAction {
  action: "screenshot" | "click" | "type" | "press_key" | "scroll" | "drag" | "get_state"
  x?: number
  y?: number
  text?: string
  key?: string
  modifiers?: ModifierKey[]
  toX?: number
  toY?: number
  deltaY?: number
}

export interface ComputerUseResult {
  success: boolean
  message?: string
  screenshot?: {
    buffer: ArrayBuffer
    width: number
    height: number
  }
  error?: string
}

export async function executeComputerUse(action: ComputerUseAction): Promise<ComputerUseResult> {
  try {
    switch (action.action) {
      case "screenshot": {
        // Capture the Cedric window
        const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
        if (!win) {
          return { success: false, error: "No window found" }
        }

        const image = await win.capturePage()
        if (image.isEmpty()) {
          return { success: false, error: "Screenshot failed" }
        }

        return {
          success: true,
          message: "Screenshot captured",
          screenshot: {
            buffer: image.toPNG().buffer,
            width: image.getSize().width,
            height: image.getSize().height,
          },
        }
      }

      case "click": {
        if (action.x === undefined || action.y === undefined) {
          return { success: false, error: "X and Y coordinates required" }
        }

        await click({
          x: action.x,
          y: action.y,
          button: "left",
          clickCount: 1,
        })

        return { success: true, message: `Clicked at (${action.x}, ${action.y})` }
      }

      case "type": {
        if (!action.text) {
          return { success: false, error: "Text required" }
        }

        await typeText({ text: action.text, pressEnter: false })

        return { success: true, message: `Typed: ${action.text}` }
      }

      case "press_key": {
        if (!action.key) {
          return { success: false, error: "Key required" }
        }

        await pressKey({
          key: action.key,
          modifiers: action.modifiers,
        })

        return { success: true, message: `Pressed: ${action.key}` }
      }

      case "scroll": {
        if (action.x === undefined || action.y === undefined) {
          return { success: false, error: "X and Y coordinates required" }
        }

        await scroll(action.x, action.y, action.deltaY || 300)

        return { success: true, message: `Scrolled at (${action.x}, ${action.y})` }
      }

      case "drag": {
        if (action.x === undefined || action.y === undefined || action.toX === undefined || action.toY === undefined) {
          return { success: false, error: "From and to coordinates required" }
        }

        await drag({
          fromX: action.x,
          fromY: action.y,
          toX: action.toX,
          toY: action.toY,
        })

        return { success: true, message: `Dragged from (${action.x}, ${action.y}) to (${action.toX}, ${action.toY})` }
      }

      case "get_state": {
        const webview = getActiveWebview()
        if (!webview || webview.isDestroyed()) {
          return { success: false, error: "No active browser session" }
        }

        const url = webview.getURL()
        const title = webview.getTitle()

        return {
          success: true,
          message: `Browser state - URL: ${url}, Title: ${title}`,
        }
      }

      default:
        return { success: false, error: "Unknown action: " + action.action }
    }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

export function registerComputerUseHandlers() {
  ipcMain.handle("computer-use", async (_event: IpcMainInvokeEvent, action: ComputerUseAction) => {
    return executeComputerUse(action)
  })
}
