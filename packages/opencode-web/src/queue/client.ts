import { Queue, Worker, Job, QueueEvents } from "bullmq"
import Redis from "ioredis"
import { config } from "../config"

// Redis connection for BullMQ
export const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
})

// Queue names
export const QUEUE_NAMES = {
  PROMPT: "prompt",
  CLEANUP: "cleanup",
  CONTAINER: "container",
} as const

// Prompt queue - for executing AI prompts
export const promptQueue = new Queue(QUEUE_NAMES.PROMPT, {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 1000,
    },
    removeOnComplete: {
      age: 24 * 60 * 60, // 24 hours
      count: 1000,
    },
    removeOnFail: {
      age: 7 * 24 * 60 * 60, // 7 days
    },
  },
})

// Cleanup queue - for cleaning up idle containers
export const cleanupQueue = new Queue(QUEUE_NAMES.CLEANUP, {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: false,
  },
})

// Container queue - for container lifecycle operations
export const containerQueue = new Queue(QUEUE_NAMES.CONTAINER, {
  connection: redis,
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: "fixed",
      delay: 5000,
    },
  },
})

// Queue events for monitoring
export const promptQueueEvents = new QueueEvents(QUEUE_NAMES.PROMPT, {
  connection: redis,
})

// Job types
export interface PromptJobData {
  taskId: string
  sessionId: string
  userId: string
  input: {
    parts: Array<{ type: string; content: string }>
    agent?: string
    model?: string
  }
}

export interface CleanupJobData {
  sessionId: string
  containerId: string
  reason: "idle" | "error" | "manual"
}

export interface ContainerJobData {
  action: "start" | "stop" | "restart"
  sessionId: string
  projectId: string
  workspaceVolume: string
}

export type { Queue, Worker, Job, QueueEvents }
