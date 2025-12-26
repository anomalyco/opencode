import z from "zod"
import { Tool } from "./tool"
import { BackgroundJobManager } from "./background-job-manager"
import { Log } from "../util/log"

const log = Log.create({ service: "job-kill-tool" })

export const JobKillTool = Tool.define("job_kill", async () => {
  return {
    description: `Terminates a running background job started by the bash tool.

Use this tool to:
- Stop long-running background jobs that are no longer needed
- Cancel stuck or misbehaving processes
- Clean up completed jobs to free resources
- Force terminate unresponsive commands

The tool will attempt to gracefully terminate the process first, then force kill if necessary.`,
    
    parameters: z.object({
      job_id: z
        .string()
        .describe("The ID of the background job to terminate (e.g., 'A1B2', 'C3D4')"),
      force: z
        .boolean()
        .describe("Whether to force immediate termination (SIGKILL) instead of graceful termination (SIGTERM)")
        .optional(),
    }),

    async execute(params, ctx) {
      const { job_id: jobId, force = false } = params
      
      log.info("Killing job", { jobId, force })

      // Validate job exists
      const job = BackgroundJobManager.getJob(jobId)
      if (!job) {
        throw new Error(`Job not found: ${jobId}. Use job_list to see all available jobs.`)
      }

      // Check if job is already completed
      if (job.status !== "running") {
        return {
          title: `Job ${jobId} already completed`,
          output: formatJobStatus(job),
          metadata: {
            job_id: jobId,
            status: job.status,
            already_completed: true,
          },
        }
      }

      const runtime = Math.floor((Date.now() - job.startTime.getTime()) / 1000)

      // Kill the job
      const success = await BackgroundJobManager.killJob(jobId)
      
      if (!success) {
        throw new Error(`Failed to terminate job ${jobId}`)
      }

      // Wait a moment for process to actually terminate
      await new Promise(resolve => setTimeout(resolve, 100))

      let output = `Job ${jobId} termination initiated.\n\n`
      output += `Job Details:\n`
      output += `- ID: ${job.id}\n`
      output += `- PID: ${job.pid}\n`
      output += `- Command: ${job.command}\n`
      output += `- Runtime: ${runtime}s\n`
      output += `- Description: ${job.description || 'None'}\n`
      output += `- Termination: ${force ? 'Force (SIGKILL)' : 'Graceful (SIGTERM)'}\n`

      if (job.description) {
        output += `- Description: ${job.description}\n`
      }

      return {
        title: `Terminated job ${jobId}`,
        output,
        metadata: {
          job_id: jobId,
          pid: job.pid,
          command: job.command,
          runtime_seconds: runtime,
          terminated: true,
          force,
        } as any,
      }
    },
  }
})

function formatJobStatus(job: any): string {
  let output = `Job ${job.id} Status:\n\n`
  output += `- Status: ${job.status}\n`
  output += `- Command: ${job.command}\n`
  output += `- PID: ${job.pid}\n`
  output += `- Runtime: ${Math.floor((Date.now() - job.startTime.getTime()) / 1000)}s\n`
  
  if (job.exitCode !== undefined) {
    output += `- Exit Code: ${job.exitCode}\n`
  }
  
  if (job.description) {
    output += `- Description: ${job.description}\n`
  }

  return output
}