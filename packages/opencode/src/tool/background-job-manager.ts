import { spawn, type ChildProcess } from "child_process"
import { Log } from "../util/log"
import { Shell } from "../shell/shell"
import { EventEmitter } from "events"

export interface BackgroundJob {
  id: string
  pid: number
  command: string
  cwd: string
  startTime: Date
  status: "running" | "completed" | "killed" | "failed"
  exitCode?: number | undefined
  output: string
  process: ChildProcess
  description?: string
}

export interface JobOptions {
  command: string
  cwd: string
  description?: string
  timeout?: number
}

const AUTO_BACKGROUND_TIMEOUT = 60 * 1000 // 1 minute
const MAX_CONCURRENT_JOBS = 50
const JOB_RETENTION_TIME = 8 * 60 * 60 * 1000 // 8 hours
const MAX_OUTPUT_LENGTH = 30_000

export namespace BackgroundJobManager {
  const log = Log.create({ service: "background-job-manager" })
  const jobs = new Map<string, BackgroundJob>()
  const eventEmitter = new EventEmitter()

  export function generateJobId(): string {
    return Math.random().toString(16).substring(2, 6).toUpperCase()
  }

  export async function startJob(options: JobOptions): Promise<{ jobId: string; isBackground: boolean }> {
    if (jobs.size >= MAX_CONCURRENT_JOBS) {
      throw new Error(`Maximum number of background jobs (${MAX_CONCURRENT_JOBS}) reached`)
    }

    const jobId = generateJobId()
    const isBackground = !options.timeout || options.timeout > AUTO_BACKGROUND_TIMEOUT

    log.info(`Starting job ${jobId}`, { 
      command: options.command, 
      cwd: options.cwd, 
      isBackground,
      timeout: options.timeout 
    })

    const proc = spawn(options.command, {
      shell: Shell.acceptable(),
      cwd: options.cwd,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    })

    const job: BackgroundJob = {
      id: jobId,
      pid: proc.pid || 0,
      command: options.command,
      cwd: options.cwd,
      startTime: new Date(),
      status: "running",
      output: "",
      process: proc,
      description: options.description,
    }

    jobs.set(jobId, job)

    // Setup output collection
    const append = (chunk: Buffer) => {
      if (job.output.length <= MAX_OUTPUT_LENGTH) {
        job.output += chunk.toString()
        // Emit update for real-time monitoring
        eventEmitter.emit("jobUpdate", { jobId, output: job.output })
      }
    }

    proc.stdout?.on("data", append)
    proc.stderr?.on("data", append)

    // Handle process completion
    proc.once("exit", (code) => {
      job.status = code === 0 ? "completed" : "failed"
      job.exitCode = code ?? undefined
      log.info(`Job ${jobId} completed`, { code, status: job.status })
      eventEmitter.emit("jobComplete", { jobId, status: job.status, exitCode: code })
      
      // Schedule cleanup
      scheduleCleanup(jobId)
    })

    proc.once("error", (error) => {
      job.status = "failed"
      job.exitCode = -1
      log.error(`Job ${jobId} failed`, { error: error.message })
      eventEmitter.emit("jobComplete", { jobId, status: "failed", error: error.message })
      scheduleCleanup(jobId)
    })

    // Start auto-cleanup timer for long-running jobs
    if (isBackground) {
      setTimeout(() => {
        if (jobs.has(jobId)) {
          log.info(`Auto-cleanup timer expired for job ${jobId}`)
          cleanupJob(jobId)
        }
      }, JOB_RETENTION_TIME)
    }

    return { jobId, isBackground }
  }

  export function getJob(jobId: string): BackgroundJob | undefined {
    return jobs.get(jobId)
  }

  export function getAllJobs(): BackgroundJob[] {
    return Array.from(jobs.values()).sort((a, b) => b.startTime.getTime() - a.startTime.getTime())
  }

  export function getRunningJobs(): BackgroundJob[] {
    return getAllJobs().filter(job => job.status === "running")
  }

  export async function killJob(jobId: string): Promise<boolean> {
    const job = jobs.get(jobId)
    if (!job) {
      return false
    }

    log.info(`Killing job ${jobId}`, { pid: job.pid, status: job.status })

    if (job.status === "running") {
      job.status = "killed"
      await Shell.killTree(job.process, { exited: () => job.status !== "running" })
      eventEmitter.emit("jobComplete", { jobId, status: "killed" })
    }

    return true
  }

  export function getJobOutput(jobId: string, maxWaitTime?: number): { output: string; status: string; completed: boolean } {
    const job = jobs.get(jobId)
    if (!job) {
      throw new Error(`Job not found: ${jobId}`)
    }

    const completed = job.status !== "running"
    let output = job.output

    if (output.length > MAX_OUTPUT_LENGTH) {
      output = output.slice(0, MAX_OUTPUT_LENGTH)
      output += `\n\n[Output truncated to ${MAX_OUTPUT_LENGTH} characters]`
    }

    return {
      output,
      status: job.status,
      completed,
    }
  }

  export function onJobUpdate(callback: (data: { jobId: string; output: string }) => void): void {
    eventEmitter.on("jobUpdate", callback)
  }

  export function onJobComplete(callback: (data: { jobId: string; status: string; exitCode?: number; error?: string }) => void): void {
    eventEmitter.on("jobComplete", callback)
  }

  function scheduleCleanup(jobId: string): void {
    setTimeout(() => {
      cleanupJob(jobId)
    }, JOB_RETENTION_TIME)
  }

  function cleanupJob(jobId: string): void {
    const job = jobs.get(jobId)
    if (!job) return

    log.info(`Cleaning up job ${jobId}`, { 
      status: job.status, 
      age: Date.now() - job.startTime.getTime() 
    })
    
    jobs.delete(jobId)
    eventEmitter.emit("jobCleanup", { jobId })
  }

  export function cleanupAllCompletedJobs(): void {
    const completedJobs = Array.from(jobs.entries())
      .filter(([_, job]) => job.status !== "running")
    
    for (const [jobId, _] of completedJobs) {
      cleanupJob(jobId)
    }
  }

  // Start periodic cleanup
  setInterval(cleanupAllCompletedJobs, 60 * 60 * 1000) // Every hour
}