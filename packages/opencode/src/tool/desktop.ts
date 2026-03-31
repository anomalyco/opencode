import z from "zod"
import { Tool } from "./tool"
import DESCRIPTION from "./desktop.txt"
import { Log } from "../util/log"
import path from "path"
import fsSync from "fs"
import { pathToFileURL } from "url"

const log = Log.create({ service: "desktop-tool" })

let nutCache: any = undefined
let nutFailed = false
let nutError: Error | undefined = undefined

export function resolveNutJsImportSpecifier(moduleURL = import.meta.url, execPath = process.execPath) {
  if (!moduleURL.includes("/$bunfs/root/")) return "@nut-tree-fork/nut-js"

  const realExecPath = fsSync.realpathSync(execPath)
  const helperPath = path.join(path.dirname(realExecPath), "desktop.runtime.mjs")
  return pathToFileURL(helperPath).href
}

async function loadNutJs() {
  if (nutCache) return nutCache
  if (nutFailed) {
    const details = nutError ? `: ${nutError.message}` : "."
    throw new Error(`Desktop automation library not available${details} Please ensure @nut-tree-fork/nut-js is installed.`)
  }
  try {
    nutCache = await import(resolveNutJsImportSpecifier())
    return nutCache
  } catch (error) {
    nutFailed = true
    nutError = error instanceof Error ? error : new Error(String(error))
    log.warn("@nut-tree-fork/nut-js not available, desktop tool disabled", { 
      error: nutError.message,
      code: (error as any)?.code,
      platform: process.platform,
      arch: process.arch 
    })
    throw new Error(`Desktop automation library not available: ${nutError.message}. Please ensure @nut-tree-fork/nut-js is installed.`)
  }
}

export const DesktopTool = Tool.define("desktop", async () => {
  return {
    description: DESCRIPTION,
    parameters: z.object({
      action: z
        .enum(["screenshot", "mouse_move", "mouse_click", "type"])
        .describe("The desktop automation action to perform"),
      region: z
        .object({
          x: z.number().describe("X coordinate of top-left corner"),
          y: z.number().describe("Y coordinate of top-left corner"),
          width: z.number().describe("Width of region in pixels"),
          height: z.number().describe("Height of region in pixels"),
        })
        .optional()
        .describe("Optional region for partial screenshot (full screen if omitted)"),
      x: z.number().optional().describe("X coordinate for mouse movement (absolute position)"),
      y: z.number().optional().describe("Y coordinate for mouse movement (absolute position)"),
      button: z.enum(["left", "right", "middle"]).optional().describe("Mouse button to click (default: left)"),
      clickAt: z
        .object({
          x: z.number().describe("X coordinate"),
          y: z.number().describe("Y coordinate"),
        })
        .optional()
        .describe("Optional coordinates to move to before clicking"),
      doubleClick: z.boolean().optional().describe("Perform double-click instead of single click"),
      text: z.string().optional().describe("Text to type"),
    }),
    async execute(params, ctx) {
      const nut = await loadNutJs()

      switch (params.action) {
        case "screenshot": {
          log.info("Taking screenshot", { region: params.region })

          let image: any
          let width: number
          let height: number

          if (params.region) {
            const region = new nut.Region(params.region.x, params.region.y, params.region.width, params.region.height)
            image = await nut.screen.grabRegion(region)
            width = params.region.width
            height = params.region.height
          } else {
            image = await nut.screen.grab()
            width = await nut.screen.width()
            height = await nut.screen.height()
          }

          const imageBuffer = await image.toPNG()
          const base64Data = imageBuffer.toString("base64")

          return {
            title: params.region ? "Partial screenshot captured" : "Screenshot captured",
            output: `Screenshot captured: ${width}x${height} pixels`,
            metadata: {
              width,
              height,
              region: params.region,
            } as any,
            attachments: [
              {
                type: "file",
                mime: "image/png",
                url: `data:image/png;base64,${base64Data}`,
              },
            ],
          }
        }

        case "mouse_move": {
          if (params.x === undefined || params.y === undefined) {
            throw new Error("mouse_move action requires x and y coordinates")
          }

          log.info("Moving mouse", { x: params.x, y: params.y })

          const target = new nut.Point(params.x, params.y)
          await nut.mouse.move(nut.straightTo(target))

          return {
            title: `Mouse moved to (${params.x}, ${params.y})`,
            output: `Moved mouse cursor to coordinates (${params.x}, ${params.y})`,
            metadata: {
              x: params.x,
              y: params.y,
            } as any,
          }
        }

        case "mouse_click": {
          const button = params.button || "left"
          const buttonEnum = {
            left: nut.Button.LEFT,
            right: nut.Button.RIGHT,
            middle: nut.Button.MIDDLE,
          }[button]

          if (params.clickAt) {
            log.info("Moving mouse to click position", { x: params.clickAt.x, y: params.clickAt.y })
            const target = new nut.Point(params.clickAt.x, params.clickAt.y)
            await nut.mouse.move(nut.straightTo(target))
          }

          log.info("Performing mouse click", { button, doubleClick: params.doubleClick })

          if (params.doubleClick) {
            await nut.mouse.doubleClick(buttonEnum)
          } else {
            await nut.mouse.click(buttonEnum)
          }

          return {
            title: params.doubleClick ? `${button} double-click performed` : `${button} click performed`,
            output: params.clickAt
              ? `Performed ${button} ${params.doubleClick ? "double-" : ""}click at (${params.clickAt.x}, ${params.clickAt.y})`
              : `Performed ${button} ${params.doubleClick ? "double-" : ""}click at current position`,
            metadata: {
              button,
              doubleClick: params.doubleClick || false,
              coordinates: params.clickAt,
            } as any,
          }
        }

        case "type": {
          if (!params.text) {
            throw new Error("type action requires text parameter")
          }

          log.info("Typing text", { length: params.text.length })

          await nut.keyboard.type(params.text)

          return {
            title: `Typed ${params.text.length} characters`,
            output: `Typed: "${params.text}"`,
            metadata: {
              length: params.text.length,
            } as any,
          }
        }

        default:
          throw new Error(`Unknown action: ${(params as any).action}`)
      }
    },
  }
})
