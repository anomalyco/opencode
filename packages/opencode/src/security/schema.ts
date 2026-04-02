import z from "zod"

export const SecurityMode = z.enum(["direct", "baseline", "rag"])
export type SecurityMode = z.infer<typeof SecurityMode>

export const SecurityControl = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  text: z.string().min(1),
  tags: z.array(z.string()).optional(),
})
export type SecurityControl = z.infer<typeof SecurityControl>

export const RetrievedControl = z.object({
  id: z.string(),
  title: z.string(),
  text: z.string(),
  tags: z.array(z.string()).optional(),
  score: z.number(),
})
export type RetrievedControl = z.infer<typeof RetrievedControl>

export const SecurityCheck = z.object({
  name: z.string(),
  passed: z.boolean(),
  detail: z.string(),
})
export type SecurityCheck = z.infer<typeof SecurityCheck>

export const SecurityVerification = z.object({
  passed: z.boolean(),
  checks: z.array(SecurityCheck),
  warnings: z.array(z.string()),
  score: z.number().min(0).max(1),
})
export type SecurityVerification = z.infer<typeof SecurityVerification>

export const SecurityAnalyzeInput = z.object({
  sessionID: z.string().optional(),
  file: z.string(),
  mode: SecurityMode.default("baseline"),
  controls: z.string().optional(),
  topk: z.number().int().positive().default(3),
  out: z.string().optional(),
  prompt: z.string().optional(),
  model: z.string().optional(),
  agent: z.string().optional(),
})
export type SecurityAnalyzeInput = z.infer<typeof SecurityAnalyzeInput>

export const SecurityAnalyzeResult = z.object({
  mode: SecurityMode,
  sessionID: z.string(),
  prompt: z.string(),
  report: z.string(),
  retrieved_controls: z.array(RetrievedControl),
  verification: SecurityVerification,
  run_dir: z.string(),
  metadata: z.record(z.string(), z.any()),
})
export type SecurityAnalyzeResult = z.infer<typeof SecurityAnalyzeResult>

export const DEFAULT_TOPK = 3
export const DEFAULT_CONTROLS_PATH = "data/security_controls.json"
export const DEFAULT_OUT_DIR = "outputs/runs"
