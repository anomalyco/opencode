import { z } from "zod"
import * as path from "path"
import { Tool } from "./tool"
import { createTwoFilesPatch } from "diff"
import { Permission } from "../permission"
import DESCRIPTION from "./morphedit.txt"
import { App } from "../app/app"
import { File } from "../file"
import { Bus } from "../bus"
import { FileTime } from "../file/time"
import { Filesystem } from "../util/filesystem"
import { Agent } from "../agent/agent"

// OpenAI-compatible client for Morph API
class MorphClient {
  private apiKey: string
  private baseURL = "https://api.morphllm.com/v1"

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  async apply(instruction: string, initialCode: string, codeEdit: string): Promise<string> {
    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: "morph-v3-large",
        messages: [
          {
            role: "user",
            content: `<instruction>${instruction}</instruction>\n<code>${initialCode}</code>\n<update>${codeEdit}</update>`,
          },
        ],
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Morph API error: ${response.status} ${response.statusText}\n${errorText}`)
    }

    const result = await response.json()
    return result.choices[0].message.content
  }
}

function trimDiff(diff: string): string {
  return diff
    .split("\n")
    .slice(4) // Remove the header lines
    .join("\n")
}

export const MorphEditTool = Tool.define("morphedit", {
  description: DESCRIPTION,
  parameters: z.object({
    target_file: z.string().describe("The target file to modify"),
    instructions: z.string().describe("A single sentence written in the first person describing what you're changing. Used to help disambiguate uncertainty in the edit."),
    code_edit: z.string().describe("Specify ONLY the precise lines of code that you wish to edit. Use `// ... existing code ...` for unchanged sections."),
  }),
  async execute(params, ctx) {
    if (!params.target_file) {
      throw new Error("target_file is required")
    }

    if (!params.instructions) {
      throw new Error("instructions is required")
    }

    if (!params.code_edit) {
      throw new Error("code_edit is required")
    }

    // Check for Morph API key
    const morphApiKey = process.env.MORPH_API_KEY
    if (!morphApiKey) {
      throw new Error("MORPH_API_KEY environment variable is required for morphedit tool")
    }

    const app = App.info()
    const filePath = path.isAbsolute(params.target_file) ? params.target_file : path.join(app.path.cwd, params.target_file)
    
    if (!Filesystem.contains(app.path.cwd, filePath)) {
      throw new Error(`File ${filePath} is not in the current working directory`)
    }

    const agent = await Agent.get(ctx.agent)
    
    // Read the existing file
    const file = Bun.file(filePath)
    const stats = await file.stat().catch(() => {})
    if (!stats) throw new Error(`File ${filePath} not found`)
    if (stats.isDirectory()) throw new Error(`Path is a directory, not a file: ${filePath}`)
    
    await FileTime.assert(ctx.sessionID, filePath)
    const initialCode = await file.text()

    // Use Morph API to apply the edit
    const morphClient = new MorphClient(morphApiKey)
    let mergedCode: string
    
    try {
      mergedCode = await morphClient.apply(params.instructions, initialCode, params.code_edit)
    } catch (error) {
      throw new Error(`Failed to apply edit with Morph: ${error instanceof Error ? error.message : String(error)}`)
    }

    const diff = trimDiff(createTwoFilesPatch(filePath, filePath, initialCode, mergedCode))
    
    // Check permissions if needed
    if (agent.permission.edit === "ask") {
      await Permission.ask({
        type: "edit",
        sessionID: ctx.sessionID,
        messageID: ctx.messageID,
        callID: ctx.callID,
        title: "Edit this file: " + filePath,
        metadata: {
          filePath,
          diff,
        },
      })
    }

    // Write the merged code to file
    await Bun.write(filePath, mergedCode)
    await Bus.publish(File.Event.Edited, {
      file: filePath,
    })

    // Return the result
    return {
      title: path.relative(app.path.root, filePath),
      metadata: {
        filePath,
        diff,
        morphApplied: true,
      },
      output: `Successfully applied edit to ${path.relative(app.path.root, filePath)} using Morph Fast Apply:\n\n${diff}`,
    }
  },
})