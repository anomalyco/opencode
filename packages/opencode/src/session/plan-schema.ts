import z from "zod"

export const PlanStep = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().optional(),
  dependencies: z.array(z.string()),
  verification: z.string().optional(),
})

export const PlanRisk = z.object({
  risk: z.string(),
  mitigation: z.string(),
})

export const PlanArtifact = z.object({
  objective: z.string(),
  in_scope: z.array(z.string()),
  out_of_scope: z.array(z.string()),
  constraints: z.array(z.string()),
  assumptions: z.array(z.string()),
  acceptance_criteria: z.array(z.string()),
  steps: z.array(PlanStep),
  risks: z.array(PlanRisk),
  metadata: z.object({
    session_id: z.string(),
    agent: z.string(),
    created_at: z.number(),
    style: z.enum(["legacy", "interrogative"]),
    interaction_style: z.enum(["codex-like", "legacy"]),
    confirmed: z.boolean(),
    question_rounds: z.number().int().min(0),
    completeness_score: z.number().min(0).max(1),
    markdown_path: z.string(),
    json_path: z.string(),
  }),
})

export type PlanArtifactInfo = z.infer<typeof PlanArtifact>
