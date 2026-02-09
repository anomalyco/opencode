import { Tool } from "./tool"
import DESCRIPTION from "./team.txt"
import z from "zod"
import { Team } from "@/team/team"
import { TeamMessageBus } from "@/team/message-bus"
import { TaskBoard } from "@/team/task-board"
import { Identifier } from "@/id/id"

const parameters = z.object({
  action: z
    .enum(["create", "status", "pause", "resume", "message"])
    .describe("The team action to perform"),
  team_id: z
    .string()
    .describe("The team ID (required for status/pause/resume/message)")
    .optional(),
  teammates: z
    .array(
      z.object({
        name: z.string().describe("Short name for this teammate (e.g., 'frontend', 'api')"),
        role: z.string().describe("Description of what this teammate should do"),
        model: z
          .object({
            providerID: z.string(),
            modelID: z.string(),
          })
          .optional()
          .describe("Optional specific model for this teammate"),
      }),
    )
    .optional()
    .describe("Teammates to create (required for 'create' action)"),
  tasks: z
    .array(
      z.object({
        title: z.string().describe("Short task title"),
        description: z.string().describe("Detailed task description"),
        dependencies: z
          .array(z.string())
          .optional()
          .describe("Task titles that must complete before this one"),
      }),
    )
    .optional()
    .describe("Tasks for the team (required for 'create' action)"),
  to: z
    .string()
    .optional()
    .describe("Recipient for message action (teammate name or 'all')"),
  content: z
    .string()
    .optional()
    .describe("Message content (required for 'message' action)"),
})

export const TeamTool = Tool.define("team", {
  description: DESCRIPTION,
  parameters,
  async execute(params, ctx) {
    switch (params.action) {
      case "create": {
        if (!params.teammates?.length)
          throw new Error("teammates are required for 'create' action")
        if (!params.tasks?.length)
          throw new Error("tasks are required for 'create' action")

        // Resolve task dependencies by title -> id mapping after creation
        const team = await Team.create({
          parentSessionID: ctx.sessionID,
          teammates: params.teammates,
          tasks: params.tasks,
          model: ctx.extra?.model
            ? { providerID: ctx.extra.model.providerID, modelID: ctx.extra.model.id }
            : undefined,
        })

        // Start the team running in background
        const model = ctx.extra?.model
          ? { providerID: ctx.extra.model.providerID, modelID: ctx.extra.model.id }
          : { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" }

        // Run the team - this spawns all teammates in parallel
        const result = await Team.run({
          teamID: team.id,
          model,
          abort: ctx.abort,
        })

        const finalStatus = await Team.status(team.id)

        const output = [
          `# Team ${team.id}`,
          ``,
          `**Status:** ${result.status}`,
          ``,
          `## Progress`,
          `- Total tasks: ${finalStatus.progress.total}`,
          `- Completed: ${finalStatus.progress.completed}`,
          `- Failed: ${finalStatus.progress.failed}`,
          `- In Progress: ${finalStatus.progress.inProgress}`,
          `- Pending: ${finalStatus.progress.pending}`,
          ``,
          `## Teammates`,
          ...result.teammates.map(
            (m) => `- **${m.name}** (${m.role}): ${m.status}`,
          ),
          ``,
          `## Task Results`,
          ...finalStatus.tasks.map(
            (t) =>
              `- **${t.title}** [${t.status}]${t.owner ? ` (by ${t.owner})` : ""}${t.result ? `\n  Result: ${t.result.slice(0, 500)}` : ""}`,
          ),
          ``,
          `## Messages (last 10)`,
          ...finalStatus.recentMessages.map(
            (m) => `- ${m.from} -> ${m.to}: ${m.content.slice(0, 200)}`,
          ),
        ].join("\n")

        return {
          title: `Team created: ${params.teammates.map((t) => t.name).join(", ")}`,
          output,
          metadata: {
            teamId: team.id,
            status: result.status,
            progress: finalStatus.progress,
          },
        }
      }

      case "status": {
        if (!params.team_id) throw new Error("team_id is required for 'status' action")

        const info = await Team.status(params.team_id)

        const output = [
          `# Team ${params.team_id} Status`,
          ``,
          `**Status:** ${info.team.status}`,
          ``,
          `## Progress`,
          `- Total: ${info.progress.total}`,
          `- Completed: ${info.progress.completed}`,
          `- Failed: ${info.progress.failed}`,
          `- In Progress: ${info.progress.inProgress}`,
          `- Pending: ${info.progress.pending}`,
          `- Blocked: ${info.progress.blocked}`,
          ``,
          `## Teammates`,
          ...info.team.teammates.map(
            (m) => `- **${m.name}** (${m.role}): ${m.status}`,
          ),
          ``,
          `## Tasks`,
          ...info.tasks.map(
            (t) =>
              `- [${t.id}] **${t.title}** | ${t.status} | owner: ${t.owner ?? "unassigned"}`,
          ),
          ``,
          `## File Claims`,
          ...(info.fileClaims.length > 0
            ? info.fileClaims.map((c) => `- ${c.path} -> ${c.owner}`)
            : ["- None"]),
          ``,
          `## Recent Messages`,
          ...info.recentMessages.map(
            (m) => `- ${m.from} -> ${m.to}: ${m.content.slice(0, 200)}`,
          ),
        ].join("\n")

        return {
          title: `Team status: ${info.team.status}`,
          output,
          metadata: {
            teamId: params.team_id,
            status: info.team.status,
            progress: info.progress,
          },
        }
      }

      case "pause": {
        if (!params.team_id) throw new Error("team_id is required for 'pause' action")

        await Team.pause(params.team_id)

        return {
          title: `Team paused`,
          output: `Team ${params.team_id} has been paused. Use action 'resume' to continue.`,
          metadata: { teamId: params.team_id },
        }
      }

      case "resume": {
        if (!params.team_id) throw new Error("team_id is required for 'resume' action")

        const model = ctx.extra?.model
          ? { providerID: ctx.extra.model.providerID, modelID: ctx.extra.model.id }
          : { providerID: "anthropic", modelID: "claude-sonnet-4-20250514" }

        const result = await Team.resume({
          teamID: params.team_id,
          model,
          abort: ctx.abort,
        })

        const finalStatus = await Team.status(params.team_id)

        return {
          title: `Team resumed`,
          output: [
            `Team ${params.team_id} resumed.`,
            `Status: ${result.status}`,
            `Progress: ${finalStatus.progress.completed}/${finalStatus.progress.total} tasks completed`,
          ].join("\n"),
          metadata: {
            teamId: params.team_id,
            status: result.status,
            progress: finalStatus.progress,
          },
        }
      }

      case "message": {
        if (!params.team_id) throw new Error("team_id is required for 'message' action")
        if (!params.to) throw new Error("to is required for 'message' action")
        if (!params.content) throw new Error("content is required for 'message' action")

        const team = await Team.get(params.team_id)
        const fromID = "lead"

        // Resolve 'to' - find teammate by name
        let toID = params.to
        if (params.to !== "all") {
          const mate = team.teammates.find((m) => m.name === params.to)
          if (mate) toID = mate.id
        }

        const msg = await TeamMessageBus.send({
          teamID: params.team_id,
          from: fromID,
          to: toID,
          content: params.content,
        })

        return {
          title: `Message sent to ${params.to}`,
          output: `Message sent to ${params.to}: ${params.content}`,
          metadata: {
            teamId: params.team_id,
            messageId: msg.id,
          },
        }
      }

      default:
        throw new Error(`Unknown action: ${params.action}`)
    }
  },
})
