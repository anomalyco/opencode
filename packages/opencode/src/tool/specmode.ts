import z from "zod/v4"
import { Tool } from "./tool"
import DESCRIPTION from "./specmode.txt"
import { Instance } from "../project/instance"
import path from "path"
import fs from "fs/promises"

const state = Instance.state(() => {
  const specSessions: {
    [sessionId: string]: {
      active: boolean
      requirements: string[]
      notes: string[]
      startedAt: number
      template?: string
    }
  } = {}
  return specSessions
})

// Export state accessor for ExitSpecMode
export function getSpecState() {
  return state()
}

// Spec templates
const TEMPLATES = {
  feature: {
    name: "Feature Specification",
    requirements: [
      "User story or use case",
      "Acceptance criteria",
      "Performance requirements",
      "Security considerations",
    ],
    notes: ["Architecture approach", "Dependencies", "Testing strategy", "Rollout plan"],
  },
  api: {
    name: "API Design",
    requirements: [
      "Endpoint paths and methods",
      "Request/response schemas",
      "Authentication/authorization",
      "Rate limiting requirements",
    ],
    notes: ["Error handling strategy", "Versioning approach", "Documentation plan"],
  },
  bugfix: {
    name: "Bug Fix",
    requirements: ["Bug description and steps to reproduce", "Expected vs actual behavior", "Impact assessment"],
    notes: ["Root cause analysis", "Proposed solution", "Testing approach", "Regression prevention"],
  },
  refactor: {
    name: "Refactoring",
    requirements: ["Current issues/technical debt", "Goals and constraints", "Success criteria"],
    notes: ["Refactoring approach", "Migration strategy", "Testing strategy"],
  },
}

export const SpecModeTool = Tool.define("specmode", {
  description: DESCRIPTION,
  parameters: z.object({
    action: z
      .enum(["enter", "add_requirement", "add_note", "get_status", "clear", "export", "load", "list_templates"])
      .describe("Action to perform"),
    content: z
      .string()
      .optional()
      .describe("Content for add_requirement/add_note actions, or filename for export/load"),
    template: z.enum(["feature", "api", "bugfix", "refactor", "none"]).optional().describe("Template to use when entering spec mode"),
  }),
  async execute(params, ctx) {
    const sessions = state()

    switch (params.action) {
      case "list_templates":
        let templateList = "# Available Spec Templates\n\n"
        for (const [key, template] of Object.entries(TEMPLATES)) {
          templateList += `## ${key}: ${template.name}\n`
          templateList += "**Requirements:**\n"
          template.requirements.forEach((req) => {
            templateList += `- ${req}\n`
          })
          templateList += "**Notes:**\n"
          template.notes.forEach((note) => {
            templateList += `- ${note}\n`
          })
          templateList += "\n"
        }
        return {
          title: "Spec Templates",
          output: templateList,
          metadata: {
            active: false,
            requirements_count: 0,
            notes_count: 0,
            duration: 0,
          },
        }

      case "enter":
        const template = params.template && params.template !== "none" ? TEMPLATES[params.template] : null

        sessions[ctx.sessionID] = {
          active: true,
          requirements: template ? [...template.requirements] : [],
          notes: template ? [...template.notes] : [],
          startedAt: Date.now(),
          template: template?.name,
        }

        let output = "Entered specification mode."
        if (template) {
          output += ` Using template: **${template.name}**\n\n`
          output += `Pre-filled with ${template.requirements.length} requirements and ${template.notes.length} notes.\n`
        }
        output += "\n\nYou can now:\n"
        output += "- Add requirements using add_requirement\n"
        output += "- Add planning notes using add_note\n"
        output += "- Check status using get_status\n"
        output += "- Export to file using export\n"
        output += "- Exit and present plan using ExitSpecMode tool"

        return {
          title: "Specification Mode Activated",
          output,
          metadata: {
            active: true,
            requirements_count: sessions[ctx.sessionID].requirements.length,
            notes_count: sessions[ctx.sessionID].notes.length,
            duration: 0,
          },
        }

      case "add_requirement":
        if (!sessions[ctx.sessionID]?.active) {
          throw new Error("Not in spec mode. Use action 'enter' first.")
        }
        if (!params.content) {
          throw new Error("Content required for add_requirement action")
        }
        sessions[ctx.sessionID].requirements.push(params.content)
        const session1 = sessions[ctx.sessionID]
        return {
          title: "Requirement Added",
          output: `Added requirement: ${params.content}\nTotal requirements: ${session1.requirements.length}`,
          metadata: {
            active: true,
            requirements_count: session1.requirements.length,
            notes_count: session1.notes.length,
            duration: Date.now() - session1.startedAt,
          },
        }

      case "add_note":
        if (!sessions[ctx.sessionID]?.active) {
          throw new Error("Not in spec mode. Use action 'enter' first.")
        }
        if (!params.content) {
          throw new Error("Content required for add_note action")
        }
        sessions[ctx.sessionID].notes.push(params.content)
        const session2 = sessions[ctx.sessionID]
        return {
          title: "Planning Note Added",
          output: `Added note: ${params.content}\nTotal notes: ${session2.notes.length}`,
          metadata: {
            active: true,
            requirements_count: session2.requirements.length,
            notes_count: session2.notes.length,
            duration: Date.now() - session2.startedAt,
          },
        }

      case "get_status":
        const session = sessions[ctx.sessionID]
        if (!session?.active) {
          return {
            title: "Spec Mode Status",
            output: "Not currently in specification mode",
            metadata: {
              active: false,
              requirements_count: 0,
              notes_count: 0,
              duration: 0,
            },
          }
        }

        const duration = Date.now() - session.startedAt
        let output2 = `# Specification Mode Status\n\n`
        output2 += `**Duration:** ${formatDuration(duration)}\n`
        if (session.template) {
          output2 += `**Template:** ${session.template}\n`
        }
        output2 += `\n## Requirements (${session.requirements.length})\n`
        session.requirements.forEach((req, i) => {
          output2 += `${i + 1}. ${req}\n`
        })
        output2 += `\n## Planning Notes (${session.notes.length})\n`
        session.notes.forEach((note, i) => {
          output2 += `${i + 1}. ${note}\n`
        })

        return {
          title: "Spec Mode Status",
          output: output2,
          metadata: {
            active: true,
            requirements_count: session.requirements.length,
            notes_count: session.notes.length,
            duration,
          },
        }

      case "export":
        const exportSession = sessions[ctx.sessionID]
        if (!exportSession?.active) {
          throw new Error("Not in spec mode. Nothing to export.")
        }

        const filename = params.content || `spec-${Date.now()}.md`
        const specDir = path.join(Instance.directory, ".opencode", "spec")
        await fs.mkdir(specDir, { recursive: true })

        const filepath = path.join(specDir, filename)
        const exportContent = generateExportContent(exportSession)
        await fs.writeFile(filepath, exportContent)

        return {
          title: "Spec Exported",
          output: `Specification exported to: ${filepath}`,
          metadata: {
            active: true,
            requirements_count: exportSession.requirements.length,
            notes_count: exportSession.notes.length,
            duration: Date.now() - exportSession.startedAt,
          },
        }

      case "load":
        if (!params.content) {
          throw new Error("Filename required for load action")
        }

        const loadFilepath = path.join(Instance.directory, ".opencode", "spec", params.content)
        const loadedContent = await fs.readFile(loadFilepath, "utf-8")
        const loaded = parseExportContent(loadedContent)

        sessions[ctx.sessionID] = {
          active: true,
          requirements: loaded.requirements,
          notes: loaded.notes,
          startedAt: Date.now(),
          template: loaded.template,
        }

        return {
          title: "Spec Loaded",
          output: `Loaded specification from: ${loadFilepath}\n${loaded.requirements.length} requirements, ${loaded.notes.length} notes`,
          metadata: {
            active: true,
            requirements_count: loaded.requirements.length,
            notes_count: loaded.notes.length,
            duration: 0,
          },
        }

      case "clear":
        const clearSession = sessions[ctx.sessionID]
        if (!clearSession?.active) {
          return {
            title: "Spec Mode Cleared",
            output: "Not currently in specification mode (nothing to clear)",
            metadata: {
              active: false,
              requirements_count: 0,
              notes_count: 0,
              duration: 0,
            },
          }
        }

        const clearedReqCount = clearSession.requirements.length
        const clearedNotesCount = clearSession.notes.length

        // Deactivate and clear
        clearSession.active = false
        clearSession.requirements = []
        clearSession.notes = []

        return {
          title: "Spec Mode Cleared",
          output: `Exited specification mode and cleared ${clearedReqCount} requirements and ${clearedNotesCount} notes.\nUse 'enter' to start a new spec session.`,
          metadata: {
            active: false,
            requirements_count: clearedReqCount,
            notes_count: clearedNotesCount,
            duration: 0,
          },
        }

      default:
        throw new Error(`Unknown action: ${params.action}`)
    }
  },
})

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) {
    const remainingMinutes = minutes % 60
    return `${hours}h ${remainingMinutes}m`
  }
  if (minutes > 0) {
    const remainingSeconds = seconds % 60
    return `${minutes}m ${remainingSeconds}s`
  }
  return `${seconds}s`
}

function generateExportContent(session: any): string {
  let content = `# Specification\n\n`
  content += `**Created:** ${new Date().toISOString()}\n`
  if (session.template) {
    content += `**Template:** ${session.template}\n`
  }
  content += `\n## Requirements\n\n`
  session.requirements.forEach((req: string, i: number) => {
    content += `${i + 1}. ${req}\n`
  })
  content += `\n## Planning Notes\n\n`
  session.notes.forEach((note: string, i: number) => {
    content += `${i + 1}. ${note}\n`
  })
  return content
}

function parseExportContent(content: string): { requirements: string[]; notes: string[]; template?: string } {
  const requirements: string[] = []
  const notes: string[] = []
  let template: string | undefined

  const lines = content.split("\n")
  let section: "none" | "requirements" | "notes" = "none"

  for (const line of lines) {
    if (line.startsWith("**Template:**")) {
      template = line.replace("**Template:**", "").trim()
    } else if (line.startsWith("## Requirements")) {
      section = "requirements"
    } else if (line.startsWith("## Planning Notes")) {
      section = "notes"
    } else if (line.match(/^\d+\.\s/)) {
      const text = line.replace(/^\d+\.\s/, "").trim()
      if (section === "requirements") {
        requirements.push(text)
      } else if (section === "notes") {
        notes.push(text)
      }
    }
  }

  return { requirements, notes, template }
}
