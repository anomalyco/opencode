import { Log } from "../util/log"
import { Job } from "./job"
import { JobStore } from "./store"
import { CronParser } from "./cron-parser"

export namespace Scheduler {
  const log = Log.create({ service: "scheduler" })

  let timer: NodeJS.Timeout | null = null
  let currentProjectID: string | null = null

  export function start(projectID: string): void {
    if (timer !== null) {
      log.info("scheduler already running", { projectID: currentProjectID })
      return
    }

    currentProjectID = projectID
    log.info("starting scheduler", { projectID })

    timer = setInterval(async () => {
      await checkDueJobs(projectID)
    }, 60_000) // 60 seconds

    log.info("scheduler started, checking every 60 seconds")
  }

  export function stop(): void {
    if (timer === null) {
      log.info("scheduler not running")
      return
    }

    clearInterval(timer)
    timer = null
    log.info("scheduler stopped", { projectID: currentProjectID })
    currentProjectID = null
  }

  export function isRunning(): boolean {
    return timer !== null
  }

  async function checkDueJobs(projectID: string): Promise<void> {
    log.debug("checking for due jobs", { projectID })

    try {
      const jobs = await JobStore.list(projectID)
      const now = Date.now()

      for (const job of jobs) {
        if (!job.enabled) {
          continue
        }

        if (job.nextRun <= now) {
          log.info("job is due", {
            jobID: job.id,
            cron: job.cron,
            nextRun: job.nextRun,
          })

          // Calculate the next run time
          const parsed = CronParser.parse(job.cron)
          const nextRun = CronParser.nextRun(parsed, now)

          // Update the job with the new nextRun time
          const updatedJob: Job.Job = {
            ...job,
            nextRun,
          }

          await JobStore.update(updatedJob)

          log.info("job would fire (session creation skipped)", {
            jobID: job.id,
            prompt: job.prompt,
            agent: job.agent,
            nextRun,
          })
        }
      }

      log.debug("job check completed", { projectID, totalJobs: jobs.length })
    } catch (error) {
      log.error("error checking due jobs", { projectID, error })
    }
  }
}
