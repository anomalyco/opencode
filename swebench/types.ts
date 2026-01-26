/**
 * SWE-bench Type Definitions
 */

/** Single instance from SWE-bench dataset */
export interface SWEInstance {
  instance_id: string
  repo: string
  base_commit: string
  problem_statement: string
  hints_text?: string
  version: string
  patch?: string
  test_patch?: string
  FAIL_TO_PASS?: string
  PASS_TO_PASS?: string
}

/** Model-generated prediction */
export interface Prediction {
  instance_id: string
  model_name_or_path: string
  model_patch: string
}

/** Run configuration */
export interface RunConfig {
  /** Dataset type */
  dataset: "lite" | "verified" | "full"
  /** Model identifier (provider/model) */
  model: string
  /** Concurrency level */
  concurrency: number
  /** Output directory */
  outputDir: string
  /** Timeout per instance (ms) */
  timeout: number
  /** Resume from previous run */
  resume?: string
  /** Limit number of instances */
  limit?: number
  /** Run specific instance IDs only */
  instances?: string[]
  /** Agent name */
  agent?: string
}

/** Result for a single instance */
export interface InstanceResult {
  instance_id: string
  status: "success" | "error" | "timeout"
  patch?: string
  error?: string
  duration: number
  retries: number
}

/** Checkpoint data for resumable runs */
export interface Checkpoint {
  runId: string
  config: RunConfig
  completed: string[]
  results: InstanceResult[]
  startTime: number
}

/** Run report */
export interface RunReport {
  runId: string
  model: string
  dataset: string
  agent?: string
  startTime: number
  endTime: number
  stats: {
    total: number
    completed: number
    success: number
    failed: number
    timeout: number
    avgDuration: number
  }
  results: InstanceResult[]
}

/** Dataset information */
export const DATASETS = {
  lite: {
    name: "princeton-nlp/SWE-bench_Lite",
    split: "test",
    count: 300,
  },
  verified: {
    name: "princeton-nlp/SWE-bench_Verified",
    split: "test",
    count: 500,
  },
  full: {
    name: "princeton-nlp/SWE-bench",
    split: "test",
    count: 2294,
  },
} as const
