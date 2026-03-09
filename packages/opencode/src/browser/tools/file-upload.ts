import z from "zod"
import { Tool } from "@/tool/tool"
import { BrowserManager } from "@/browser/manager"
import { Log } from "@/util/log"

const log = Log.create({ service: "browser-tools" })

const DESCRIPTION = `Upload files to a file input element.

Sets files on a file input element. Can upload one or multiple files.
The selector should target an <input type="file"> element.

Parameters:
- selector (string, required): CSS selector or description of the file input element
- files (array, required): Array of file paths to upload
`

export const BrowserFileUploadTool = Tool.define("browser_file_upload", {
  description: DESCRIPTION,
  parameters: z.object({
    selector: z.string().describe("CSS selector or description of the file input element"),
    files: z.array(z.string()).describe("Array of file paths to upload"),
  }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "browser",
      patterns: ["file_upload"],
      always: ["*"],
      metadata: { action: "file_upload", selector: params.selector, fileCount: params.files.length },
    })

    log.info("uploading files", { selector: params.selector, files: params.files })

    try {
      await BrowserManager.uploadFiles(params.selector, params.files)

      return {
        title: "Files uploaded",
        metadata: { selector: params.selector, fileCount: params.files.length },
        output: `Uploaded ${params.files.length} file(s) to ${params.selector}:\n${params.files.map((f) => `  - ${f}`).join("\n")}`,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error("file upload failed", { error: message })
      throw new Error(`File upload failed: ${message}`)
    }
  },
})

Tool.attachExecute(BrowserFileUploadTool)
