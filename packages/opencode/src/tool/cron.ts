import z from "zod"
import { Tool } from "./tool"
import { JobStore } from "../scheduler/store"
import { Job } from "../scheduler/job"
import { CronParser } from "../scheduler/cron-parser"
import { Instance } from "../project/instance"

interface CronMetadata {
  id: string
  cron: string
  prompt: string
  agent: string
  nextRun: number
  description: string
  jobs?: {
    id: string
    status: string
    schedule: string
    cron: string
    prompt: string
    agent: string
    nextRun: string
    runCount: number
    createdAt: string
  }[]
  count?: number
  deleted?: boolean
}

export const CronTool = Tool.define("cron", {
  description: "Manage scheduled recurring agent tasks. Create, list, and delete cron jobs.",
  parameters: z.object({
    action: z.enum(["create", "list", "delete"]).describe("The action to perform"),
    cron: z.string().optional().describe("Cron expression (e.g., '0 */4 * * *') for create action"),
    prompt: z.string().optional().describe("The task prompt for create action"),
    agent: z.string().optional().describe("Agent to use for create action (default: 'build')"),
    id: z.string().optional().describe("Job ID for delete action"),
  }),
  async execute(params, ctx): Promise<{ title: string; output: string; metadata: CronMetadata }> {
    switch (params.action) {
      case "create": {
        if (!params.cron) {
          throw new Error("Missing required parameter 'cron' for create action")
        }
        if (!params.prompt) {
          throw new Error("Missing required parameter 'prompt' for create action")
        }

        if (!CronParser.isValid(params.cron)) {
          throw new Error(`Invalid cron expression: ${params.cron}`)
        }

        const projectID = Instance.project.id
        const job = Job.create({
          cron: params.cron,
          prompt: params.prompt,
          agent: params.agent || "build",
          projectID,
        })

        await JobStore.save(job)

        const description = CronParser.humanReadable(params.cron)
        const nextRunDate = new Date(job.nextRun)

        return {
          title: `Cron job created: ${description}`,
          output: `Created cron job with ID: ${job.id}\nSchedule: ${description}\nNext run: ${nextRunDate.toISOString()}\nAgent: ${job.agent}`,
          metadata: {
            id: job.id,
            cron: job.cron,
            prompt: job.prompt,
            agent: job.agent,
            nextRun: job.nextRun,
            description,
          },
        }
      }

      case "list": {
        const projectID = Instance.project.id
        const jobs = await JobStore.list(projectID)

        if (jobs.length === 0) {
          return {
            title: "No cron jobs",
            output: "No cron jobs found for this project.",
            metadata: {
              id: "",
              cron: "",
              prompt: "",
              agent: "",
              nextRun: 0,
              description: "",
              jobs: [],
              count: 0,
            },
          }
        }

        const formatted = jobs.map((job) => {
          const description = CronParser.humanReadable(job.cron)
          const nextRunDate = new Date(job.nextRun)
          const status = job.enabled ? "enabled" : "disabled"

          return {
            id: job.id,
            status,
            schedule: description,
            cron: job.cron,
            prompt: job.prompt,
            agent: job.agent,
            nextRun: nextRunDate.toISOString(),
            runCount: job.runCount,
            createdAt: new Date(job.createdAt).toISOString(),
          }
        })

        return {
          title: `${jobs.length} cron job${jobs.length === 1 ? "" : "s"}`,
          output: formatted
            .map(
              (j) =>
                `ID: ${j.id}\nStatus: ${j.status}\nSchedule: ${j.schedule}\nNext run: ${j.nextRun}\nRun count: ${j.runCount}\nAgent: ${j.agent}\nPrompt: ${j.prompt}\n`,
            )
            .join("\n---\n"),
          metadata: {
            id: "",
            cron: "",
            prompt: "",
            agent: "",
            nextRun: 0,
            description: "",
            jobs: formatted,
            count: jobs.length,
          },
        }
      }

      case "delete": {
        if (!params.id) {
          throw new Error("Missing required parameter 'id' for delete action")
        }

        const projectID = Instance.project.id
        const removed = await JobStore.remove(params.id, projectID)

        if (!removed) {
          throw new Error(`Job not found: ${params.id}`)
        }

        return {
          title: `Cron job deleted: ${params.id}`,
          output: `Successfully deleted cron job: ${params.id}`,
          metadata: {
            id: params.id,
            cron: "",
            prompt: "",
            agent: "",
            nextRun: 0,
            description: "",
            deleted: true,
          },
        }
      }
    }
  },
})
