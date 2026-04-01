import { randomBytes } from "crypto"
import { CronParser } from "./cron-parser"

function generateId(prefix: string): string {
  const time = Date.now()
  const rand = randomBytes(8).toString("hex")
  return `${prefix}_${time.toString(36)}_${rand}`
}

export namespace Job {
  export interface Input {
    cron: string
    prompt: string
    agent: string
    projectID: string
    tags?: string[]
  }

  export interface Job {
    id: string
    cron: string
    prompt: string
    agent: string
    projectID: string
    tags: string[]
    enabled: boolean
    runCount: number
    lastRun?: number
    lastStatus?: "success" | "failure" | "running"
    lastOutput?: string
    nextRun: number
    createdAt: number
  }

  export function create(input: Input): Job {
    if (!CronParser.isValid(input.cron)) {
      throw new Error(`Invalid cron expression: ${input.cron}`)
    }

    const parsed = CronParser.parse(input.cron)
    const now = Date.now()

    return {
      id: generateId("job"),
      cron: input.cron,
      prompt: input.prompt,
      agent: input.agent,
      projectID: input.projectID,
      tags: input.tags ?? [],
      enabled: true,
      runCount: 0,
      nextRun: CronParser.nextRun(parsed, now),
      createdAt: now,
    }
  }

  export function markRun(job: Job, status: "success" | "failure" | "running", output?: string): Job {
    const parsed = CronParser.parse(job.cron)
    const now = Date.now()

    return {
      ...job,
      runCount: job.runCount + 1,
      lastRun: now,
      lastStatus: status,
      lastOutput: output,
      nextRun: CronParser.nextRun(parsed, now),
    }
  }

  export function toggle(job: Job): Job {
    return {
      ...job,
      enabled: !job.enabled,
    }
  }
}
