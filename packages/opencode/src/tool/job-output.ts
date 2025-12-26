import z from "zod"
import { Tool } from "./tool"
import { BackgroundJobManager } from "./background-job-manager"
import { Log } from "../util/log"

const log = Log.create({ service: "job-output-tool" })

export const JobOutputTool = Tool.define("job_output", async () => {
  return {
    description: `Retrieves the output and status of a background job started by the bash tool.

Use this tool to:
- Check the progress of running background jobs (immediate return)
- Wait for job completion with optional timeout
- View the complete output of completed jobs
- Monitor job status (running, completed, failed, killed)

The tool returns the current output and whether the job has finished.`,
    
    parameters: z.object({
      job_id: z
        .string()
        .describe("The ID of the background job to check output for (e.g., 'A1B2', 'C3D4')"),
      max_wait_time: z
        .number()
        .optional()
        .describe("Maximum time in seconds to wait for job completion (max 300 seconds). If not set or set to 0, will return immediately without waiting."),
    }),

    async execute(params, ctx) {
      const { job_id: jobId, max_wait_time } = params

      log.info("Getting job output", { jobId, maxWaitTime: max_wait_time })

      // Validate job exists
      const job = BackgroundJobManager.getJob(jobId)
      if (!job) {
        throw new Error(`Job not found: ${jobId}. Use job_list to see all available jobs.`)
      }

      // Function to get current output
      const getCurrentOutput = () => {
        const result = BackgroundJobManager.getJobOutput(jobId)
        return {
          output: result.output,
          status: result.status,
          completed: result.completed,
          runtime: Math.floor((Date.now() - job.startTime.getTime()) / 1000),
        }
      }

      // Get initial output immediately
      let current = getCurrentOutput()

      // If job is not done and max_wait_time is specified and > 0, wait for completion
      if (!current.completed && max_wait_time && max_wait_time > 0) {
        const maxWaitMs = Math.min(max_wait_time * 1000, 300 * 1000)
        const startTime = Date.now()

        // Wait for either completion or timeout
        await new Promise<void>((resolve) => {
          const checkInterval = setInterval(() => {
            current = getCurrentOutput()

            // Check if job completed or timeout reached
            const timeElapsed = Date.now() - startTime
            if (current.completed || timeElapsed >= maxWaitMs) {
              clearInterval(checkInterval)
              resolve()
            }
          }, 100) // Check every 100ms

          // Also listen for job completion events
          BackgroundJobManager.onJobComplete((data) => {
            if (data.jobId === jobId) {
              current = getCurrentOutput()
              clearInterval(checkInterval)
              resolve()
            }
          })
        })
      }

      // Format output parts
      const outputParts: string[] = []
      if (current.output) {
        outputParts.push(current.output)
      }

      // Determine status and add any status-specific messages
      let status = current.status
      if (status === "completed") {
        // Job completed, no additional message needed
      } else if (max_wait_time && max_wait_time > 0) {
        // Job is still running after waiting period
        outputParts.push(`Task is still running after waiting ${max_wait_time} seconds. Try calling again with a longer wait time.`)
      }
      // If max_wait_time is 0 or not set, we just return current status without timeout message

      const finalOutput = outputParts.length > 0 ? outputParts.join("\n") : "No output"

      const formattedOutput = formatJobOutput(job, current, finalOutput)

      return {
        title: `Output for job ${jobId}`,
        output: formattedOutput,
        metadata: {
          job_id: jobId,
          status: current.status,
          completed: current.completed,
          runtime_seconds: current.runtime,
          command: job.command,
        },
      }
    },
  }
})

function formatJobOutput(job: any, current: any, output: string): string {
  let result = `Status: ${current.status}\n\n`
  result += output

  if (current.status === "completed" && job.exitCode !== undefined) {
    if (job.exitCode !== 0) {
      result += `\nExit code ${job.exitCode}`
    }
  }

  return result
}