import z from "zod"
import { Tool } from "./tool"
import { BackgroundJobManager } from "./background-job-manager"
import { Log } from "../util/log"

const log = Log.create({ service: "job-list-tool" })

export const JobListTool = Tool.define("job_list", async () => {
  return {
    description: `Lists all background jobs started by the bash tool.

Use this tool to:
- View all running and completed background jobs
- Check job status, runtime, and command details
- Find job IDs for use with other job_* tools
- Monitor system resource usage from background jobs

The tool provides a comprehensive overview of all managed background processes.`,
    
    parameters: z.object({
      status: z
        .enum(["running", "completed", "failed", "killed", "all"])
        .describe("Filter jobs by status. If not specified, shows all jobs")
        .optional(),
      limit: z
        .number()
        .describe("Maximum number of jobs to display (default: 20). Use 0 for no limit.")
        .optional(),
      format: z
        .enum(["table", "json", "detailed"])
        .describe("Output format: 'table' for readable table, 'json' for machine-readable, 'detailed' for full details")
        .optional(),
    }),

    async execute(params, ctx) {
      const { status = "all", limit = 20, format = "table" } = params
      
      log.info("Listing jobs", { status, limit, format })

      let jobs = BackgroundJobManager.getAllJobs()

      // Filter by status if specified
      if (status !== "all") {
        jobs = jobs.filter(job => job.status === status)
      }

      // Apply limit
      const displayJobs = limit > 0 ? jobs.slice(0, limit) : jobs

      // Format output based on requested format
      let output: string

      switch (format) {
        case "json":
          output = formatJsonOutput(displayJobs, jobs.length)
          break
        case "detailed":
          output = formatDetailedOutput(displayJobs, jobs.length)
          break
        case "table":
        default:
          output = formatTableOutput(displayJobs, jobs.length)
          break
      }

      return {
        title: `Background Jobs (${status === "all" ? "All" : status})`,
        output,
        metadata: {
          total_jobs: jobs.length,
          displayed_jobs: displayJobs.length,
          status_filter: status,
          format,
          running_jobs: BackgroundJobManager.getRunningJobs().length,
        },
      }
    },
  }
})

function formatTableOutput(jobs: any[], totalJobs: number): string {
  if (jobs.length === 0) {
    return "No background jobs found."
  }

  let output = `Background Jobs (${jobs.length} of ${totalJobs}):\n\n`
  
  // Table header
  output += "ID    | Status   | Runtime  | PID    | Command\n"
  output += "------|----------|----------|--------|------------------\n"

  // Table rows
  for (const job of jobs) {
    const runtime = Math.floor((Date.now() - job.startTime.getTime()) / 1000)
    const runtimeStr = formatRuntime(runtime)
    const statusStr = job.status.padEnd(8)
    const commandStr = job.command.length > 30 ? job.command.substring(0, 27) + "..." : job.command
    
    output += `${job.id.padEnd(5)} | ${statusStr} | ${runtimeStr.padEnd(8)} | ${String(job.pid).padEnd(6)} | ${commandStr}\n`
  }

  output += "\nUse job_output <id> to view output, job_kill <id> to terminate."
  
  return output
}

function formatJsonOutput(jobs: any[], totalJobs: number): string {
  const jsonData = {
    total_jobs: totalJobs,
    jobs: jobs.map(job => ({
      id: job.id,
      pid: job.pid,
      command: job.command,
      cwd: job.cwd,
      status: job.status,
      exit_code: job.exitCode,
      start_time: job.startTime.toISOString(),
      runtime_seconds: Math.floor((Date.now() - job.startTime.getTime()) / 1000),
      description: job.description,
      output_length: job.output.length,
    }))
  }

  return JSON.stringify(jsonData, null, 2)
}

function formatDetailedOutput(jobs: any[], totalJobs: number): string {
  if (jobs.length === 0) {
    return "No background jobs found."
  }

  let output = `Background Jobs (${jobs.length} of ${totalJobs}):\n\n`

  for (const job of jobs) {
    const runtime = Math.floor((Date.now() - job.startTime.getTime()) / 1000)
    
    output += `Job ID: ${job.id}\n`
    output += `  Status: ${job.status}\n`
    output += `  PID: ${job.pid}\n`
    output += `  Command: ${job.command}\n`
    output += `  Working Directory: ${job.cwd}\n`
    output += `  Runtime: ${formatRuntime(runtime)}\n`
    output += `  Started: ${job.startTime.toLocaleString()}\n`
    
    if (job.description) {
      output += `  Description: ${job.description}\n`
    }
    
    if (job.exitCode !== undefined) {
      output += `  Exit Code: ${job.exitCode}\n`
    }
    
    output += `  Output Size: ${job.output.length} characters\n`
    
    if (job.status === "running") {
      output += `  Output Preview: ${job.output.substring(0, 100)}${job.output.length > 100 ? "..." : ""}\n`
    }
    
    output += "\n" + "─".repeat(50) + "\n\n"
  }

  output += "Use job_output <id> for full output, job_kill <id> to terminate."
  
  return output
}

function formatRuntime(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`
  } else if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = seconds % 60
    return `${minutes}m ${remainingSeconds}s`
  } else {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    return `${hours}h ${minutes}m`
  }
}